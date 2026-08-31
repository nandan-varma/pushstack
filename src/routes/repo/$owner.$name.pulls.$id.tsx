import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { NotFoundCard } from "@/components/NotFoundCard";
import { pullRequestStatusVariant } from "@/components/status-variants";
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
	pullRequestByNumberQueryOptions,
	pullRequestCommentsQueryOptions,
	pullRequestDiffQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";
import { createComment } from "@/server/comments";
import { mergePullRequest, updatePullRequest } from "@/server/pull-requests";

// react-markdown/remark-gfm/rehype-highlight are lazy-loaded here (same
// pattern as CommentCard.tsx/FilePreview.tsx) so this route's chunk doesn't
// eagerly ship them to every visitor.
const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export const Route = createFileRoute("/repo/$owner/$name/pulls/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const prNumber = Number(params.id);
		const isValidNumber = Number.isFinite(prNumber);
		// getPullRequestByNumber resolves the repo server-side, so this can
		// still run in parallel with the repo query below rather than waiting
		// on it.
		const [repo, pr] = await Promise.all([
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
			isValidNumber
				? queryClient.ensureQueryData(
						pullRequestByNumberQueryOptions({
							owner: params.owner,
							name: params.name,
							number: prNumber,
						}),
					)
				: Promise.resolve(undefined),
		]);

		// Comments are keyed by the PR's internal id, only known once the PR
		// itself has resolved — can't start this in parallel with it.
		if (pr) {
			await queryClient
				.ensureQueryData(pullRequestCommentsQueryOptions(pr.id))
				.catch(() => {});
		}

		// MarkdownRenderer (PR body + comments) resolves `#123` references using
		// these — fire-and-forget so the extra round trip doesn't land after the
		// body has already rendered.
		if (repo) {
			queryClient
				.ensureQueryData(repositoryIssueNumbersQueryOptions(repo.id))
				.catch(() => {});
			queryClient
				.ensureQueryData(repositoryPullRequestNumbersQueryOptions(repo.id))
				.catch(() => {});
		}

		// The "Files changed" diff previously only fired client-side after the
		// component mounted and saw `pr` resolved — a visible waterfall on every
		// PR view. We already know pr.sourceBranch/targetBranch here, so kick it
		// off now too (fire-and-forget — the diff isn't needed for the loader's
		// own response, just likely to be needed moments later).
		if (pr) {
			queryClient
				.ensureQueryData(
					pullRequestDiffQueryOptions({
						repoId: pr.repoId,
						sourceBranch: pr.sourceBranch,
						targetBranch: pr.targetBranch,
						autoRefresh: !!repo?.autoRefreshPrDiffs,
					}),
				)
				.catch(() => {});
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
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const prNumber = Number(id);
	const { data: pr, isLoading } = useQuery(
		pullRequestByNumberQueryOptions({ owner, name, number: prNumber }),
	);

	const { data: comments } = useQuery({
		...pullRequestCommentsQueryOptions(pr?.id ?? -1),
		enabled: !!pr,
	});

	const { data: diff, isLoading: diffLoading } = useQuery({
		...pullRequestDiffQueryOptions({
			repoId: pr?.repoId ?? 0,
			sourceBranch: pr?.sourceBranch ?? "",
			targetBranch: pr?.targetBranch ?? "",
			autoRefresh: !!repo?.autoRefreshPrDiffs,
		}),
		enabled: !!pr,
	});

	const prQueryKey = queryKeys.pullRequestByNumber(owner, name, prNumber);

	const mergeMutation = useMutation({
		mutationFn: mergePullRequest,
		...useOptimisticUpdate<typeof pr>(
			prQueryKey,
			(old) => (old ? { ...old, status: "merged" } : old),
			"Failed to merge pull request",
		),
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
		...useOptimisticUpdate<typeof pr>(
			prQueryKey,
			(old, vars) => {
				const newStatus = (
					vars as { data: { status?: "open" | "closed" } } | undefined
				)?.data.status;
				return old ? { ...old, status: newStatus ?? old.status } : old;
			},
			"Failed to update pull request",
		),
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
			if (pr)
				await queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestComments(pr.id),
				});
		},
	});

	const handleMerge = () => {
		if (!pr) return;
		mergeMutation.mutate({ data: { prId: pr.id } });
	};

	const handleClose = () => {
		if (!pr) return;
		updateMutation.mutate({ data: { prId: pr.id, status: "closed" } });
	};

	const handleReopen = () => {
		if (!pr) return;
		updateMutation.mutate({ data: { prId: pr.id, status: "open" } });
	};

	const handleAddComment = () => {
		if (!pr || !newComment.trim()) return;
		commentMutation.mutate({
			data: {
				repoId: pr.repoId,
				pullRequestId: pr.id,
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

	if (!pr) {
		return (
			<NotFoundCard
				title="Pull Request Not Found"
				backTo="/repo/$owner/$name/pulls"
				backParams={{ owner, name }}
				backLabel="Back to Pull Requests"
			/>
		);
	}

	const canMerge = pr.status === "open" && !!session?.user;

	return (
		<div className="space-y-6">
			{/* Header */}
			<DetailHeader
				title={pr.title}
				badge={
					<Badge variant={pullRequestStatusVariant(pr.status)}>
						{pr.status}
					</Badge>
				}
				meta={
					<p className="flex flex-wrap items-center gap-1 text-muted-foreground">
						#{pr.number} opened{" "}
						{formatDistanceToNow(new Date(pr.createdAt), { addSuffix: true })}{" "}
						by {pr.author?.name || "Unknown"} •{" "}
						<span className="inline-flex items-center gap-1">
							{pr.sourceBranch}
							<ArrowRight className="size-3" />
							{pr.targetBranch}
						</span>
					</p>
				}
				actions={
					<>
						<BackLink to="/repo/$owner/$name/pulls" params={{ owner, name }} />
						{canMerge && (
							<>
								<LoadingButton
									variant="default"
									size="sm"
									onClick={handleMerge}
									isLoading={mergeMutation.isPending}
									loadingLabel="Merging…"
									disabled={updateMutation.isPending}
								>
									Merge
								</LoadingButton>
								<LoadingButton
									variant="outline"
									size="sm"
									onClick={handleClose}
									isLoading={updateMutation.isPending}
									loadingLabel="Closing…"
									disabled={mergeMutation.isPending}
								>
									Close
								</LoadingButton>
							</>
						)}
						{pr.status === "closed" && session?.user && (
							<LoadingButton
								variant="default"
								size="sm"
								onClick={handleReopen}
								isLoading={updateMutation.isPending}
								loadingLabel="Reopening…"
							>
								Reopen
							</LoadingButton>
						)}
					</>
				}
			/>

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
							<span className="font-medium text-foreground">
								{pr.author?.name || "Unknown"}
							</span>
							<span className="text-sm text-muted-foreground">
								{formatDistanceToNow(new Date(pr.createdAt), {
									addSuffix: true,
								})}
							</span>
						</div>
						{pr.body ? (
							<Suspense fallback={<Skeleton className="h-20" />}>
								<MarkdownRenderer
									content={pr.body}
									owner={owner}
									name={name}
									repoId={pr.repoId}
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

			{/* Files changed */}
			<Card className="p-6">
				<h3 className="text-lg font-semibold text-foreground">
					Files changed{" "}
					{diff?.files && (
						<span className="text-sm font-normal text-muted-foreground">
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
					<h3 className="text-lg font-semibold text-foreground">
						Comments ({comments.length})
					</h3>
					{comments.map((comment) => (
						<CommentCard
							key={comment.id}
							comment={comment}
							owner={owner}
							name={name}
							repoId={pr.repoId}
						/>
					))}
				</div>
			)}

			{/* Add Comment */}
			{!session?.user ? (
				<Card className="p-6">
					<p className="text-sm text-muted-foreground">
						<Link
							to="/auth/login"
							className="font-medium text-primary hover:underline"
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
