import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { NotFoundCard } from "@/components/NotFoundCard";
import { issueStatusVariant } from "@/components/status-variants";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	authSessionQueryOptions,
	issueCommentsQueryOptions,
	issueQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { createComment } from "@/server/comments";
import { updateIssue } from "@/server/issues";

export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const issueId = Number(params.id);
		// The issue/comments queries key off params.id, not the repo — no need
		// to wait on the repo fetch before starting them.
		const [repo] = await Promise.all([
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
			...(Number.isFinite(issueId)
				? [
						queryClient.ensureQueryData(issueQueryOptions(issueId)),
						queryClient.ensureQueryData(issueCommentsQueryOptions(issueId)),
					]
				: []),
		]);

		// MarkdownRenderer (issue body + comments) resolves `#123` references
		// using these — fire-and-forget so the extra round trip doesn't land
		// after the body has already rendered.
		if (repo) {
			queryClient
				.ensureQueryData(repositoryIssueNumbersQueryOptions(repo.id))
				.catch(() => {});
			queryClient
				.ensureQueryData(repositoryPullRequestNumbersQueryOptions(repo.id))
				.catch(() => {});
		}
	},
	component: IssueDetailPage,
});

function IssueDetailPage() {
	const { owner, name, id } = Route.useParams();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [newComment, setNewComment] = useState("");

	const { data: session } = useQuery(authSessionQueryOptions());
	const issueId = Number(id);
	const { data: issue, isLoading } = useQuery(issueQueryOptions(issueId));

	const { data: comments } = useQuery(issueCommentsQueryOptions(issueId));

	const issueQueryKey = queryKeys.issue(issueId);

	const updateMutation = useMutation({
		mutationFn: updateIssue,
		onMutate: async (vars) => {
			await queryClient.cancelQueries({ queryKey: issueQueryKey });
			const prev = queryClient.getQueryData(issueQueryKey);
			const newStatus = (
				vars as { data: { status?: "open" | "closed" } } | undefined
			)?.data.status;
			queryClient.setQueryData(issueQueryKey, (old: typeof issue) =>
				old ? { ...old, status: newStatus ?? old.status } : old,
			);
			return { prev };
		},
		onError: (err: Error, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(issueQueryKey, ctx.prev);
			toast(err.message || "Failed to update issue", "error");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: issueQueryKey });
			if (issue)
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(issue.repoId),
				});
		},
	});

	const commentMutation = useMutation({
		mutationFn: createComment,
		onSuccess: async () => {
			setNewComment("");
			await queryClient.invalidateQueries({
				queryKey: queryKeys.issueComments(issueId),
			});
			toast("Comment posted", "success");
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to post comment", "error");
		},
	});

	const handleToggleStatus = () => {
		if (!issue) return;
		updateMutation.mutate({
			data: {
				issueId: Number(id),
				status: issue.status === "open" ? "closed" : "open",
			},
		});
	};

	const handleAddComment = () => {
		if (!newComment.trim() || !issue) return;
		commentMutation.mutate({
			data: {
				issueId: Number(id),
				repoId: issue.repoId,
				body: newComment,
			},
		});
	};

	if (isLoading) {
		return (
			<div className="space-y-6">
				<DetailHeaderSkeleton />
				<AvatarBodySkeleton />
			</div>
		);
	}

	if (!issue) {
		return (
			<NotFoundCard
				title="Issue Not Found"
				backTo="/repo/$owner/$name/issues"
				backParams={{ owner, name }}
				backLabel="Back to Issues"
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<DetailHeader
				title={issue.title}
				badge={
					<Badge variant={issueStatusVariant(issue.status)}>
						{issue.status}
					</Badge>
				}
				meta={
					<p className="text-[var(--sea-ink-soft)]">
						#{issue.id} opened{" "}
						{formatDistanceToNow(new Date(issue.createdAt), {
							addSuffix: true,
						})}{" "}
						by {issue.author?.name || "Unknown"}
					</p>
				}
				actions={
					<>
						<BackLink to="/repo/$owner/$name/issues" params={{ owner, name }} />
						{session?.user && (
							<LoadingButton
								variant={issue.status === "open" ? "outline" : "default"}
								size="sm"
								onClick={handleToggleStatus}
								isLoading={updateMutation.isPending}
								loadingLabel={
									issue.status === "open" ? "Closing…" : "Reopening…"
								}
							>
								{issue.status === "open" ? "Close Issue" : "Reopen Issue"}
							</LoadingButton>
						)}
					</>
				}
			/>

			{/* Issue Body */}
			<Card className="p-6">
				<div className="flex items-start gap-4">
					<Avatar>
						<AvatarImage src={issue.author?.image || undefined} />
						<AvatarFallback>
							{getInitials(issue.author?.name || "U")}
						</AvatarFallback>
					</Avatar>
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-4">
							<span className="font-medium text-[var(--sea-ink)]">
								{issue.author?.name || "Unknown"}
							</span>
							<span className="text-sm text-[var(--sea-ink-soft)]">
								{formatDistanceToNow(new Date(issue.createdAt), {
									addSuffix: true,
								})}
							</span>
						</div>
						{issue.body ? (
							<MarkdownRenderer
								content={issue.body}
								owner={owner}
								name={name}
								repoId={issue.repoId}
							/>
						) : (
							<p className="text-[var(--sea-ink-soft)] italic">
								No description provided
							</p>
						)}
					</div>
				</div>
			</Card>

			{/* Comments */}
			{comments && comments.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-semibold text-[var(--sea-ink)]">
						Comments ({comments.length})
					</h2>
					{comments.map((comment) => (
						<CommentCard
							key={comment.id}
							comment={comment}
							owner={owner}
							name={name}
							repoId={issue.repoId}
						/>
					))}
				</div>
			)}

			{/* Add Comment */}
			{session?.user && (
				<CommentForm
					value={newComment}
					onChange={setNewComment}
					onSubmit={handleAddComment}
					isPending={commentMutation.isPending}
					disabled={issue.status !== "open"}
				/>
			)}
		</div>
	);
}
