import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { lazy, Suspense, useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { NotFoundCard } from "@/components/NotFoundCard";
import { issueStatusVariant } from "@/components/status-variants";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import {
	authSessionQueryOptions,
	issueByNumberQueryOptions,
	issueCommentsQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { createComment } from "@/server/comments";
import { updateIssue } from "@/server/issues";

// react-markdown/remark-gfm/rehype-highlight are lazy-loaded here (same
// pattern as CommentCard.tsx/FilePreview.tsx) so this route's chunk doesn't
// eagerly ship them to every visitor.
const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const issueNumber = Number(params.id);
		const isValidNumber = Number.isFinite(issueNumber);
		// getIssueByNumber resolves the repo server-side, so this can still run
		// in parallel with the repo query below rather than waiting on it.
		const [repo, issue] = await Promise.all([
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
			isValidNumber
				? queryClient.ensureQueryData(
						issueByNumberQueryOptions({
							owner: params.owner,
							name: params.name,
							number: issueNumber,
						}),
					)
				: Promise.resolve(undefined),
		]);

		// Comments are keyed by the issue's internal id, only known once the
		// issue itself has resolved — can't start this in parallel with it.
		if (issue) {
			await queryClient
				.ensureQueryData(issueCommentsQueryOptions(issue.id))
				.catch(() => {});
		}

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
	const issueNumber = Number(id);
	const { data: issue, isLoading } = useQuery(
		issueByNumberQueryOptions({ owner, name, number: issueNumber }),
	);

	const { data: comments } = useQuery({
		...issueCommentsQueryOptions(issue?.id ?? -1),
		enabled: !!issue,
	});

	const issueQueryKey = queryKeys.issueByNumber(owner, name, issueNumber);

	const updateMutation = useMutation({
		mutationFn: updateIssue,
		...useOptimisticUpdate<typeof issue>(
			issueQueryKey,
			(old, vars) => {
				const newStatus = (
					vars as { data: { status?: "open" | "closed" } } | undefined
				)?.data.status;
				return old ? { ...old, status: newStatus ?? old.status } : old;
			},
			"Failed to update issue",
		),
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
			if (issue)
				await queryClient.invalidateQueries({
					queryKey: queryKeys.issueComments(issue.id),
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
				issueId: issue.id,
				status: issue.status === "open" ? "closed" : "open",
			},
		});
	};

	const handleAddComment = () => {
		if (!newComment.trim() || !issue) return;
		commentMutation.mutate({
			data: {
				issueId: issue.id,
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
					<p className="text-muted-foreground">
						#{issue.number} opened{" "}
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
							<span className="font-medium text-foreground">
								{issue.author?.name || "Unknown"}
							</span>
							<span className="text-sm text-muted-foreground">
								{formatDistanceToNow(new Date(issue.createdAt), {
									addSuffix: true,
								})}
							</span>
						</div>
						{issue.body ? (
							<Suspense fallback={<Skeleton className="h-20" />}>
								<MarkdownRenderer
									content={issue.body}
									owner={owner}
									name={name}
									repoId={issue.repoId}
								/>
							</Suspense>
						) : (
							<p className="text-muted-foreground italic">
								No description provided
							</p>
						)}
					</div>
				</div>
			</Card>

			{/* Comments */}
			{comments && comments.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-semibold text-foreground">
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
