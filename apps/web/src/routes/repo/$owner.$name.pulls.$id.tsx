import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { CommentCard } from "@/components/CommentCard";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { EditableTitle } from "@/components/EditableTitle";
import { EmptyState } from "@/components/EmptyState";
import { IssueAssignees } from "@/components/IssueAssignees";
import { NotFoundCard } from "@/components/NotFoundCard";
import { CommitList } from "@/components/repo/CommitList";
import { DeleteMergedBranchCard } from "@/components/repo/DeleteMergedBranchCard";
import { PullRequestFilesTab } from "@/components/repo/PullRequestFilesTab";
import {
	pullRequestStatusVariant,
	reviewStatusLabel,
	reviewStatusVariant,
} from "@/components/status-variants";
import {
	ThreadConversation,
	useThreadComments,
} from "@/components/ThreadConversation";
import { ThreadLabels } from "@/components/ThreadLabels";
import { useToast } from "@/components/toast-provider";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
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
import { ensureThreadNumberRedirect } from "@/lib/thread-number-redirect";
import { mergePullRequest, updatePullRequest } from "@/server/pull-requests";

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
				.catch((error: unknown) =>
					ensureThreadNumberRedirect(
						error,
						params,
						() =>
							queryClient.ensureQueryData(
								issueByNumberQueryOptions({
									owner: params.owner,
									name: params.name,
									number: prNumber,
								}),
							),
						"/repo/$owner/$name/issues/$id",
					),
				),
		]);

		// Comments are keyed by the PR's internal id, only known once the PR
		// itself has resolved — can't start this in parallel with it.
		if (pr) {
			await queryClient
				.ensureInfiniteQueryData(pullRequestCommentsQueryOptions(pr.id))
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

	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const prNumber = Number(id);
	const { data: pr, isLoading } = useQuery(
		pullRequestByNumberQueryOptions({ owner, name, number: prNumber }),
	);

	const comments = useThreadComments({
		thread: pr ? { pullRequestId: pr.id } : undefined,
		commentsQueryKey: pullRequestCommentsQueryOptions(pr?.id ?? 0).queryKey,
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
	const canEdit = pr.viewer.canWrite || session?.user?.id === pr.authorId;
	const canChangeStatus =
		pr.status !== "merged" &&
		(pr.viewer.canWrite || session?.user?.id === pr.authorId);

	return (
		<div className="space-y-6">
			{/* Header */}
			<DetailHeader
				title={
					<EditableTitle
						title={pr.title}
						onSave={
							canEdit
								? (title) =>
										updateMutation.mutateAsync({
											data: { prId: pr.id, title },
										})
								: undefined
						}
						isSaving={updateMutation.isPending}
					/>
				}
				badge={
					<div className="flex items-center gap-2">
						<Badge variant={pullRequestStatusVariant(pr.status)}>
							{pr.status}
						</Badge>
						{pr.review.summary.state && (
							<Badge variant={reviewStatusVariant(pr.review.summary.state)}>
								{reviewStatusLabel(pr.review.summary.state)}
							</Badge>
						)}
					</div>
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
					<CommentCard
						comment={pr}
						owner={owner}
						name={name}
						repoId={pr.repoId}
						allowEmpty
						isSaving={updateMutation.isPending}
						onSave={
							canEdit
								? (body) =>
										updateMutation.mutateAsync({
											data: { prId: pr.id, body },
										})
								: undefined
						}
					/>

					<IssueAssignees
						pullRequestId={pr.id}
						repoId={pr.repoId}
						assignees={pr.assignees.map((a) => a.user)}
						canEdit={pr.viewer.canWrite}
						onChanged={() => {
							queryClient.invalidateQueries({
								queryKey: pullRequestByNumberQueryOptions({
									owner,
									name,
									number: pr.number,
								}).queryKey,
							});
						}}
					/>
					<ThreadLabels
						owner={owner}
						name={name}
						repoId={pr.repoId}
						number={pr.number}
						labels={pr.labels}
						canEdit={pr.viewer.canWrite}
					/>

					<ThreadConversation
						owner={owner}
						name={name}
						repoId={pr.repoId}
						number={pr.number}
						comments={comments}
						commentsOptions={pullRequestCommentsQueryOptions(pr.id)}
						canParticipate={pr.viewer.canParticipate}
						canModerate={pr.viewer.canWrite}
					/>
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
					<PullRequestFilesTab
						owner={owner}
						name={name}
						pr={pr}
						diff={diff}
						diffLoading={diffLoading}
					/>
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
