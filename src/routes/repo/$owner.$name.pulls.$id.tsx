import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm } from "@/components/CommentForm";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	authSessionQueryOptions,
	pullRequestCommentsQueryOptions,
	pullRequestDiffQueryOptions,
	pullRequestQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { createComment } from "@/server/comments";
import { mergePullRequest, updatePullRequest } from "@/server/pull-requests";

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
	const { toast } = useToast();
	const [newComment, setNewComment] = useState("");

	const { data: session } = useQuery(authSessionQueryOptions());
	const prId = Number(id);
	const { data: pr, isLoading } = useQuery(pullRequestQueryOptions(prId));

	const { data: comments } = useQuery(pullRequestCommentsQueryOptions(prId));

	const { data: diff, isLoading: diffLoading } = useQuery({
		...pullRequestDiffQueryOptions({
			repoId: pr?.repoId ?? 0,
			sourceBranch: pr?.sourceBranch ?? "",
			targetBranch: pr?.targetBranch ?? "",
		}),
		enabled: !!pr,
	});

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
		onError: (err: Error, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(prQueryKey, ctx.prev);
			toast(err.message || "Failed to merge pull request", "error");
		},
		onSuccess: () => {
			toast("Pull request merged", "success");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: prQueryKey });
			if (pr) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestsRoot(pr.repoId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoFilesRoot(pr.repoId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoCommitsRoot(pr.repoId),
				});
			}
		},
	});

	const updateMutation = useMutation({
		mutationFn: updatePullRequest,
		onMutate: async (vars) => {
			await queryClient.cancelQueries({ queryKey: prQueryKey });
			const prev = queryClient.getQueryData(prQueryKey);
			const newStatus = (
				vars as { data: { status?: "open" | "closed" } } | undefined
			)?.data.status;
			queryClient.setQueryData(prQueryKey, (old: typeof pr) =>
				old ? { ...old, status: newStatus ?? old.status } : old,
			);
			return { prev };
		},
		onError: (err: Error, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(prQueryKey, ctx.prev);
			toast(err.message || "Failed to update pull request", "error");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: prQueryKey });
			if (pr)
				queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestsRoot(pr.repoId),
				});
		},
	});

	const commentMutation = useMutation({
		mutationFn: createComment,
		onError: (err: Error) => {
			toast(err.message || "Failed to post comment", "error");
		},
		onSuccess: async () => {
			toast("Comment posted", "success");
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

	const canMerge = pr.status === "open" && !!session?.user;

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
					<p className="flex flex-wrap items-center gap-1 text-[var(--sea-ink-soft)]">
						#{pr.id} opened{" "}
						{formatDistanceToNow(new Date(pr.createdAt), { addSuffix: true })}{" "}
						by {pr.author?.name || "Unknown"} •{" "}
						<span className="inline-flex items-center gap-1">
							{pr.sourceBranch}
							<ArrowRight className="size-3" />
							{pr.targetBranch}
						</span>
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
					{pr.status === "closed" && session?.user && (
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

			{/* Description */}
			<Card className="p-6">
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
							<p className="text-sm text-[var(--sea-ink-soft)]">{pr.body}</p>
						) : (
							<p className="text-[var(--sea-ink-soft)] italic">
								No description provided
							</p>
						)}
					</div>
				</div>
			</Card>

			{/* Files changed */}
			<Card className="p-6">
				<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
					Files changed{" "}
					{diff?.files && (
						<span className="text-sm font-normal text-[var(--sea-ink-soft)]">
							({diff.files.length} file{diff.files.length !== 1 ? "s" : ""},{" "}
							<span className="text-green-600">+{diff.totalAdditions}</span>{" "}
							<span className="text-red-600">-{diff.totalDeletions}</span>)
						</span>
					)}
				</h3>
				<FileDiffViewer
					files={diff?.files}
					isLoading={diffLoading}
					emptyMessage={`No changes between ${pr.sourceBranch} and ${pr.targetBranch}.`}
				/>
			</Card>

			{/* Comments */}
			{comments && comments.length > 0 && (
				<div className="space-y-4">
					<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
						Comments ({comments.length})
					</h3>
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
			{!session?.user ? (
				<Card className="p-6">
					<p className="text-sm text-[var(--sea-ink-soft)]">
						<Link
							to="/auth/login"
							className="font-medium text-[var(--lagoon-deep)] hover:underline"
						>
							Sign in
						</Link>{" "}
						to add a comment.
					</p>
				</Card>
			) : (
				<CommentForm
					value={newComment}
					onChange={setNewComment}
					onSubmit={handleAddComment}
					isPending={commentMutation.isPending}
				/>
			)}
		</div>
	);
}
