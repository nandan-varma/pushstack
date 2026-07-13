import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm } from "@/components/CommentForm";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	authSessionQueryOptions,
	issueCommentsQueryOptions,
	issueQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { createComment } from "@/server/comments";
import { updateIssue } from "@/server/issues";

export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const issueId = Number(params.id);
		await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (Number.isFinite(issueId)) {
			await Promise.all([
				queryClient.ensureQueryData(issueQueryOptions(issueId)),
				queryClient.ensureQueryData(issueCommentsQueryOptions(issueId)),
			]);
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
			<div className="">
				<div className="space-y-4">
					<Skeleton className="h-8 w-1/2" />
					<Skeleton className="h-64" />
				</div>
			</div>
		);
	}

	if (!issue) {
		return (
			<div className="">
				<Card className="p-6">
					<h2 className="text-xl font-semibold mb-2">Issue Not Found</h2>
					<Link
						to="/repo/$owner/$name/issues"
						params={{ owner, name }}
						className="mt-4 inline-block"
					>
						<Button variant="outline">Back to Issues</Button>
					</Link>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1">
					<div className="flex items-center gap-3 mb-2">
						<h1 className="text-3xl font-bold text-[var(--sea-ink)]">
							{issue.title}
						</h1>
						<Badge variant={issue.status === "open" ? "success" : "default"}>
							{issue.status}
						</Badge>
					</div>
					<p className="text-[var(--sea-ink-soft)]">
						#{issue.id} opened{" "}
						{formatDistanceToNow(new Date(issue.createdAt), {
							addSuffix: true,
						})}{" "}
						by {issue.author?.name || "Unknown"}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Link to="/repo/$owner/$name/issues" params={{ owner, name }}>
						<Button variant="outline" size="sm">
							Back
						</Button>
					</Link>
					{session?.user && (
						<Button
							variant={issue.status === "open" ? "outline" : "default"}
							size="sm"
							onClick={handleToggleStatus}
							disabled={updateMutation.isPending}
						>
							{issue.status === "open" ? "Close Issue" : "Reopen Issue"}
						</Button>
					)}
				</div>
			</div>

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
							<p className="text-sm text-[var(--sea-ink-soft)]">{issue.body}</p>
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
