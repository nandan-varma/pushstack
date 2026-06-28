import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { lazy, Suspense, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
	pullRequestCommentsQueryOptions,
	pullRequestQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import {
	createComment,
	mergePullRequest,
	updatePullRequest,
} from "@/server/issues";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export const Route = createFileRoute("/repo/$owner/$name/pulls/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const prId = Number(params.id);
		await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (Number.isFinite(prId)) {
			await Promise.all([
				queryClient.ensureQueryData(pullRequestQueryOptions(prId)),
				queryClient.ensureQueryData(pullRequestCommentsQueryOptions(prId)),
			]);
		}
	},
	component: PullRequestDetailPage,
});

function PullRequestDetailPage() {
	const { owner, name, id } = Route.useParams();
	const queryClient = useQueryClient();
	const [newComment, setNewComment] = useState("");

	const prId = Number(id);
	const { data: pr, isLoading } = useQuery(pullRequestQueryOptions(prId));

	const { data: comments } = useQuery(pullRequestCommentsQueryOptions(prId));

	const prQueryKey = queryKeys.pullRequest(prId);

	const mergeMutation = useMutation({
		mutationFn: mergePullRequest,
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: prQueryKey });
			const prev = queryClient.getQueryData(prQueryKey);
			queryClient.setQueryData(prQueryKey, (old: typeof pr) =>
				old ? { ...old, status: "merged" } : old,
			);
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(prQueryKey, ctx.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: prQueryKey });
			if (pr) {
				queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestsRoot(pr.repoId) });
				queryClient.invalidateQueries({ queryKey: queryKeys.repoFilesRoot(pr.repoId) });
				queryClient.invalidateQueries({ queryKey: queryKeys.repoCommitsRoot(pr.repoId) });
			}
		},
	});

	const updateMutation = useMutation({
		mutationFn: updatePullRequest,
		onMutate: async (vars) => {
			await queryClient.cancelQueries({ queryKey: prQueryKey });
			const prev = queryClient.getQueryData(prQueryKey);
			queryClient.setQueryData(prQueryKey, (old: typeof pr) =>
				old ? { ...old, status: vars.data.status ?? old.status } : old,
			);
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(prQueryKey, ctx.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: prQueryKey });
			if (pr) queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestsRoot(pr.repoId) });
		},
	});

	const commentMutation = useMutation({
		mutationFn: createComment,
		onSuccess: async () => {
			setNewComment("");
			await queryClient.invalidateQueries({
				queryKey: queryKeys.pullRequestComments(prId),
			});
		},
	});

	const handleMerge = () => {
		mergeMutation.mutate({ data: { prId: Number(id) } });
	};

	const handleClose = () => {
		updateMutation.mutate({ data: { prId: Number(id), status: "closed" } });
	};

	const handleReopen = () => {
		updateMutation.mutate({ data: { prId: Number(id), status: "open" } });
	};

	const handleAddComment = () => {
		if (!pr || !newComment.trim()) return;
		commentMutation.mutate({
			data: {
				repoId: pr.repoId,
				pullRequestId: prId,
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

	if (!pr) {
		return (
			<div className="">
				<Card className="p-6">
					<h2 className="text-xl font-semibold mb-2">Pull Request Not Found</h2>
					<Link
						to="/repo/$owner/$name/pulls"
						params={{ owner, name }}
						className="mt-4 inline-block"
					>
						<Button variant="outline">Back to Pull Requests</Button>
					</Link>
				</Card>
			</div>
		);
	}

	const getInitials = (name: string) =>
		name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);

	const getStatusBadgeVariant = (status: string) => {
		switch (status) {
			case "open":
				return "success";
			case "merged":
				return "info";
			case "closed":
				return "default";
			default:
				return "default";
		}
	};

	const canMerge = pr.status === "open";

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1">
					<div className="flex items-center gap-3 mb-2">
						<h1 className="text-3xl font-bold text-[var(--sea-ink)]">
							{pr.title}
						</h1>
						<Badge variant={getStatusBadgeVariant(pr.status)}>
							{pr.status}
						</Badge>
					</div>
					<p className="text-[var(--sea-ink-soft)]">
						#{pr.id} opened{" "}
						{formatDistanceToNow(new Date(pr.createdAt), { addSuffix: true })}{" "}
						by {pr.author?.name || "Unknown"} • {pr.sourceBranch} →{" "}
						{pr.targetBranch}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Link to="/repo/$owner/$name/pulls" params={{ owner, name }}>
						<Button variant="outline" size="sm">
							Back
						</Button>
					</Link>
					{canMerge && (
						<>
							<Button
								variant="default"
								size="sm"
								onClick={handleMerge}
								disabled={mergeMutation.isPending}
							>
								{mergeMutation.isPending ? "Merging..." : "Merge"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleClose}
								disabled={updateMutation.isPending}
							>
								Close
							</Button>
						</>
					)}
					{pr.status === "closed" && (
						<Button
							variant="default"
							size="sm"
							onClick={handleReopen}
							disabled={updateMutation.isPending}
						>
							Reopen
						</Button>
					)}
				</div>
			</div>

			<Card className="p-6 space-y-6">
				<div className="flex items-start gap-4">
					<Avatar>
						<AvatarImage src={pr.author?.image || undefined} />
						<AvatarFallback>
							{getInitials(pr.author?.name || "U")}
						</AvatarFallback>
					</Avatar>
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-4">
							<span className="font-medium text-[var(--sea-ink)]">
								{pr.author?.name || "Unknown"}
							</span>
							<span className="text-sm text-[var(--sea-ink-soft)]">
								{formatDistanceToNow(new Date(pr.createdAt), {
									addSuffix: true,
								})}
							</span>
						</div>
						{pr.body ? (
							<Suspense fallback={<Skeleton className="h-24" />}>
								<MarkdownRenderer content={pr.body} />
							</Suspense>
						) : (
							<p className="text-[var(--sea-ink-soft)] italic">
								No description provided
							</p>
						)}
					</div>
				</div>

				{comments && comments.length > 0 && (
					<div className="space-y-4">
						{comments.map((comment) => (
							<Card key={comment.id} className="p-6">
								<div className="flex items-start gap-4">
									<Avatar>
										<AvatarImage src={comment.author?.image || undefined} />
										<AvatarFallback>
											{getInitials(comment.author?.name || "U")}
										</AvatarFallback>
									</Avatar>
									<div className="flex-1">
										<div className="flex items-center gap-2 mb-4">
											<span className="font-medium text-[var(--sea-ink)]">
												{comment.author?.name || "Unknown"}
											</span>
											<span className="text-sm text-[var(--sea-ink-soft)]">
												{formatDistanceToNow(new Date(comment.createdAt), {
													addSuffix: true,
												})}
											</span>
										</div>
										<Suspense fallback={<Skeleton className="h-20" />}>
											<MarkdownRenderer content={comment.body} />
										</Suspense>
									</div>
								</div>
							</Card>
						))}
					</div>
				)}

				<div>
					<h3 className="text-lg font-semibold text-[var(--sea-ink)] mb-4">
						Add a Comment
					</h3>
					{pr.status === "open" ? (
						<div className="space-y-4">
							<Textarea
								value={newComment}
								onChange={(e) => setNewComment(e.target.value)}
								placeholder="Write your comment here... (Markdown supported)"
								rows={6}
							/>
							<div className="flex justify-end">
								<Button
									onClick={handleAddComment}
									disabled={!newComment.trim() || commentMutation.isPending}
								>
									{commentMutation.isPending ? "Posting..." : "Post Comment"}
								</Button>
							</div>
						</div>
					) : (
						<p className="text-sm text-[var(--sea-ink-soft)]">
							This pull request is {pr.status}. Reopen it to add a comment.
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}
