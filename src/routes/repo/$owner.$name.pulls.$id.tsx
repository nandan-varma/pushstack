import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	isNotFound,
	notFound,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { EmptyState } from "@/components/EmptyState";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { NotFoundCard } from "@/components/NotFoundCard";
import { CommitList } from "@/components/repo/CommitList";
import { DeleteMergedBranchCard } from "@/components/repo/DeleteMergedBranchCard";
import { pullRequestStatusVariant } from "@/components/status-variants";
import { ThreadTimeline } from "@/components/timeline/ThreadTimeline";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { quoteForReply } from "@/lib/markdown-quote";
import {
	authSessionQueryOptions,
	issueByNumberQueryOptions,
	pullRequestByNumberQueryOptions,
	pullRequestCommentsQueryOptions,
	pullRequestCommitsQueryOptions,
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

const PR_TABS = ["conversation", "commits", "files"] as const;
type PrTab = (typeof PR_TABS)[number];

export const Route = createFileRoute("/repo/$owner/$name/pulls/$id")({
	validateSearch: (search: Record<string, unknown>): { tab?: PrTab } => ({
		tab: PR_TABS.includes(search.tab as PrTab)
			? (search.tab as PrTab)
			: undefined,
	}),
	loader: async ({ params, context: { queryClient } }) => {
		const prNumber = Number(params.id);
		if (!Number.isInteger(prNumber) || prNumber < 1) throw notFound();
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
			queryClient
				.ensureQueryData(
					pullRequestByNumberQueryOptions({
						owner: params.owner,
						name: params.name,
						number: prNumber,
					}),
				)
				.catch(async (error: unknown) => {
					// Issues and pull requests share one number sequence: send a
					// number that belongs to a issue to its page.
					if (!isNotFound(error)) throw error;
					const other = await queryClient
						.ensureQueryData(
							issueByNumberQueryOptions({
								owner: params.owner,
								name: params.name,
								number: prNumber,
							}),
						)
						.catch(() => null);
					if (other) {
						throw redirect({
							to: "/repo/$owner/$name/issues/$id",
							params,
							statusCode: 301,
						});
					}
					throw error;
				}),
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

		// Start the "Files changed" diff now rather than after mount; the page
		// renders without it.
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
	notFoundComponent: PullRequestNotFound,
});

function PullRequestDetailPage() {
	const { owner, name, id } = Route.useParams();
	const { tab = "conversation" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
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

	const { data: prCommits, isLoading: commitsLoading } = useQuery({
		...pullRequestCommitsQueryOptions({
			prId: pr?.id ?? -1,
			autoRefresh: !!repo?.autoRefreshPrDiffs,
		}),
		// Two bounded history walks: only when the tab is shown.
		enabled: !!pr && tab === "commits",
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
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(pr.repoId),
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
			if (pr) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestsRoot(pr.repoId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(pr.repoId),
				});
			}
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
			if (pr) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.pullRequestComments(pr.id),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(pr.repoId),
				});
			}
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

	if (!pr) return <PullRequestNotFound />;

	// The mutations re-check these server-side; deriving the buttons from the same
	// permissions is what keeps the page from offering an action that can only
	// fail — a Merge button for someone who may not merge.
	const canMerge = pr.status === "open" && pr.viewer.canMerge;
	const canChangeStatus =
		pr.status !== "merged" &&
		(pr.viewer.canWrite || session?.user?.id === pr.authorId);

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
						by {pr.author.name} •{" "}
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
						)}
						{canChangeStatus && pr.status === "open" && (
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
						)}
						{canChangeStatus && pr.status === "closed" && (
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
			{pr.status !== "open" && pr.viewer.canWrite && repo && (
				<DeleteMergedBranchCard
					repoId={repo.id}
					prId={pr.id}
					branch={pr.sourceBranch}
					defaultBranch={repo.defaultBranch}
				/>
			)}

			<Tabs
				value={tab}
				onValueChange={(value) =>
					navigate({
						search: {
							tab: value === "conversation" ? undefined : (value as PrTab),
						},
						replace: true,
					})
				}
			>
				<TabsList variant="line">
					<TabsTrigger value="conversation">Conversation</TabsTrigger>
					<TabsTrigger value="commits">
						Commits
						{prCommits ? (
							<span className="ml-1 rounded-full bg-muted px-1.5 text-xs">
								{prCommits.commits.length}
								{prCommits.truncated || prCommits.incomplete ? "+" : ""}
							</span>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="files">
						Files changed
						{diff?.files ? (
							<span className="ml-1 rounded-full bg-muted px-1.5 text-xs">
								{diff.files.length}
							</span>
						) : null}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="conversation" className="space-y-6">
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
										{pr.author.name}
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

					<ThreadTimeline
						owner={owner}
						name={name}
						repoId={pr.repoId}
						number={pr.number}
						comments={comments ?? []}
						onQuote={
							pr.viewer.canParticipate
								? (body) =>
										setNewComment((draft) => draft + quoteForReply(body))
								: undefined
						}
					/>

					{pr.viewer.canParticipate ? (
						<CommentForm
							value={newComment}
							onChange={setNewComment}
							onSubmit={handleAddComment}
							isPending={commentMutation.isPending}
						/>
					) : !session?.user ? (
						<SignInToComment />
					) : null}
				</TabsContent>
				<TabsContent value="commits" className="space-y-3">
					{commitsLoading ? (
						<div className="space-y-2">
							{[1, 2, 3].map((i) => (
								<Skeleton key={i} className="h-16" />
							))}
						</div>
					) : prCommits?.commits.length ? (
						<>
							<CommitList
								owner={owner}
								name={name}
								commits={prCommits.commits}
							/>
							{prCommits.incomplete ? (
								<p className="text-center text-xs text-muted-foreground">
									This list may be incomplete: {pr.targetBranch} has moved far
									past where this branch started, so some commits shown may
									already be on it.
								</p>
							) : prCommits.truncated ? (
								<p className="text-center text-xs text-muted-foreground">
									Showing the first {prCommits.commits.length} commits; newer
									ones are not listed.
								</p>
							) : null}
						</>
					) : (
						<EmptyState
							message={`No commits on ${pr.sourceBranch} that aren't on ${pr.targetBranch}.`}
						/>
					)}
				</TabsContent>
				<TabsContent value="files">
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
							sides={{
								owner,
								name,
								oldRef: diff?.oldRef,
								newRef: diff?.newRef ?? pr.sourceBranch,
							}}
							isLoading={diffLoading}
							emptyMessage={`No changes between ${pr.sourceBranch} and ${pr.targetBranch}.`}
						/>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function PullRequestNotFound() {
	const { owner, name } = Route.useParams();
	return (
		<NotFoundCard
			title="Pull Request Not Found"
			backTo="/repo/$owner/$name/pulls"
			backParams={{ owner, name }}
			backLabel="Back to Pull Requests"
		/>
	);
}
