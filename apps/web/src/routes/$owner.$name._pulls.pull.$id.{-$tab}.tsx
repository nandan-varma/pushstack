import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import {
	FileDiff,
	GitCommitHorizontal,
	GitMerge,
	MessageSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { BranchChip } from "@/components/BranchChip";
import { CommentCard } from "@/components/CommentCard";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { useEditableTitle } from "@/components/EditableTitle";
import { EmptyState } from "@/components/EmptyState";
import { IssueAssignees } from "@/components/IssueAssignees";
import { SplitLayout } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { ReactionBar } from "@/components/ReactionBar";
import { RelativeTime } from "@/components/RelativeTime";
import { CommitList } from "@/components/repo/CommitList";
import { DeleteMergedBranchCard } from "@/components/repo/DeleteMergedBranchCard";
import { StatePill } from "@/components/StatePill";
import {
	reviewStatusLabel,
	reviewStatusVariant,
} from "@/components/status-variants";
import {
	ThreadConversation,
	useThreadComments,
} from "@/components/ThreadConversation";
import { ThreadLabels } from "@/components/ThreadLabels";
import { ThreadSubscriptionButton } from "@/components/ThreadSubscriptionButton";
import { MergeBox } from "@/components/thread/MergeBox";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { splitPatchSuffix } from "@/lib/compare-spec";
import { backgroundQuery, contentQuery } from "@/lib/prefetch";
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
	threadReactionsQueryOptions,
} from "@/lib/query-options";
import { ensureThreadNumberRedirect } from "@/lib/thread-number-redirect";
import { mergePullRequest, updatePullRequest } from "@/server/pull-requests";

// The "Files changed" tab (diff viewer, review threads, language detection)
// only downloads when that tab is opened.
const PullRequestFilesTab = lazy(() =>
	import("@/components/repo/PullRequestFilesTab").then((m) => ({
		default: m.PullRequestFilesTab,
	})),
);

const PR_PATH_TABS = ["commits", "files"] as const;
type PrTab = (typeof PR_PATH_TABS)[number];

export const Route = createFileRoute("/$owner/$name/_pulls/pull/$id/{-$tab}")({
	// GitHub's pull request URLs: `/pull/{n}` (conversation), `/pull/{n}/commits`
	// and `/pull/{n}/files`; `/pull/{n}.diff` and `.patch` are plain text.
	server: {
		handlers: {
			GET: async ({ params, next }) => {
				const suffix = splitPatchSuffix(params.id);
				if (!suffix) return next();
				const { servePullPatch } = await import("#/server/web-patches");
				return servePullPatch(
					params.owner,
					params.name,
					suffix.name,
					suffix.format,
				);
			},
		},
	},
	loader: async ({ params, context: { queryClient } }) => {
		// The conversation is `/pull/{n}` itself; only the other tabs have a segment.
		if (
			params.tab !== undefined &&
			!PR_PATH_TABS.includes(params.tab as PrTab)
		) {
			throw notFound();
		}
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
						"/$owner/$name/issues/$id",
					),
				),
		]);

		// Comments are keyed by the PR's internal id, only known once the PR
		// itself has resolved — can't start this in parallel with it.
		if (pr) {
			await Promise.all([
				queryClient
					.ensureInfiniteQueryData(pullRequestCommentsQueryOptions(pr.id))
					.catch(() => {}),
				queryClient
					.ensureQueryData(threadReactionsQueryOptions(pr.repoId, pr.number))
					.catch(() => {}),
			]);
		}

		// MarkdownRenderer (PR body + comments) resolves `#123` references using
		// these — fire-and-forget so the extra round trip doesn't land after the
		// body has already rendered.
		if (repo) {
			await Promise.all([
				contentQuery(queryClient, repositoryIssueNumbersQueryOptions(repo.id)),
				contentQuery(
					queryClient,
					repositoryPullRequestNumbersQueryOptions(repo.id),
				),
			]);
		}

		// Start the "Files changed" diff now rather than after mount; the page
		// renders without it.
		if (pr) {
			backgroundQuery(
				queryClient,
				pullRequestDiffQueryOptions({
					repoId: pr.repoId,
					sourceBranch: pr.sourceBranch,
					targetBranch: pr.targetBranch,
					autoRefresh: !!repo?.autoRefreshPrDiffs,
				}),
			);
		}
	},
	component: PullRequestDetailPage,
	notFoundComponent: PullRequestNotFound,
});

function PullRequestDetailPage() {
	const params = Route.useParams();
	const { owner, name, id } = params;
	const tab = (params.tab as PrTab | undefined) ?? "conversation";
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
				// The sidebar shows open counts from the repository row.
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
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
				// The sidebar shows open counts from the repository row.
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
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

	const editableTitle = useEditableTitle({
		title: pr?.title ?? "",
		onSave:
			pr && (pr.viewer.canWrite || session?.user?.id === pr.authorId)
				? (title) =>
						updateMutation.mutateAsync({ data: { prId: pr.id, title } })
				: undefined,
		isSaving: updateMutation.isPending,
	});

	if (isLoading) {
		return (
			<div>
				<DetailHeaderSkeleton />
				<SplitLayout main={<AvatarBodySkeleton />} />
			</div>
		);
	}

	if (!pr) return <PullRequestNotFound />;

	const canMerge = pr.status === "open" && pr.viewer.canMerge;
	const canEdit = pr.viewer.canWrite || session?.user?.id === pr.authorId;
	const canChangeStatus =
		pr.status !== "merged" &&
		(pr.viewer.canWrite || session?.user?.id === pr.authorId);

	const { titleNode, editButton } = editableTitle;
	const commitCount = prCommits?.commits.length;

	return (
		<div>
			<DetailHeader
				title={titleNode}
				number={pr.number}
				badge={<StatePill kind="pull" status={pr.status} />}
				meta={
					<>
						<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
							<span className="font-medium text-bjork-text">
								{pr.author.name}
							</span>
							{pr.status === "merged" ? "merged" : "wants to merge"}
							{commitCount !== undefined && (
								<>
									{" "}
									{commitCount}
									{prCommits?.truncated ? "+" : ""}{" "}
									{commitCount === 1 ? "commit" : "commits"}
								</>
							)}{" "}
							into
							<BranchChip owner={owner} name={name} branch={pr.targetBranch} />
							from
							<BranchChip owner={owner} name={name} branch={pr.sourceBranch} />
							<span className="text-bjork-text-soft">
								· <RelativeTime date={pr.createdAt} />
							</span>
						</p>
						{pr.review.summary.state && (
							<Badge variant={reviewStatusVariant(pr.review.summary.state)}>
								{reviewStatusLabel(pr.review.summary.state)}
							</Badge>
						)}
					</>
				}
				actions={editButton}
			/>

			<Tabs
				value={tab}
				className="gap-6"
				onValueChange={(value) =>
					navigate({
						params: (prev) => ({
							...prev,
							tab: value === "conversation" ? undefined : (value as PrTab),
						}),
						replace: true,
					})
				}
			>
				<TabsList>
					<TabsTrigger value="conversation">
						<MessageSquare aria-hidden="true" />
						Conversation
					</TabsTrigger>
					<TabsTrigger value="commits">
						<GitCommitHorizontal aria-hidden="true" />
						Commits
						{prCommits ? (
							<TabCount>
								{prCommits.commits.length}
								{prCommits.truncated || prCommits.incomplete ? "+" : ""}
							</TabCount>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="files">
						<FileDiff aria-hidden="true" />
						Files changed
						{diff?.files ? <TabCount>{diff.files.length}</TabCount> : null}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="conversation">
					<SplitLayout
						main={
							<>
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
									footer={
										<ReactionBar
											repoId={pr.repoId}
											number={pr.number}
											canReact={pr.viewer.canParticipate}
										/>
									}
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
									beforeComposer={
										<>
											{pr.status === "open" && (
												<MergeBox
													repoId={repo?.id}
													canMerge={canMerge}
													sourceBranch={pr.sourceBranch}
													targetBranch={pr.targetBranch}
													action={
														<LoadingButton
															onClick={handleMerge}
															isLoading={mergeMutation.isPending}
															loadingLabel="Merging…"
															disabled={updateMutation.isPending}
															className="bg-success text-white hover:bg-success/90"
														>
															<GitMerge aria-hidden="true" />
															Merge pull request
														</LoadingButton>
													}
												/>
											)}
											{pr.status !== "open" && pr.viewer.canWrite && repo && (
												<DeleteMergedBranchCard
													repoId={repo.id}
													prId={pr.id}
													branch={pr.sourceBranch}
													defaultBranch={repo.defaultBranch}
												/>
											)}
										</>
									}
									composerAction={
										canChangeStatus && pr.status === "open" ? (
											<LoadingButton
												variant="outline"
												onClick={handleClose}
												isLoading={updateMutation.isPending}
												loadingLabel="Closing…"
												disabled={mergeMutation.isPending}
											>
												Close pull request
											</LoadingButton>
										) : canChangeStatus && pr.status === "closed" ? (
											<LoadingButton
												variant="outline"
												onClick={handleReopen}
												isLoading={updateMutation.isPending}
												loadingLabel="Reopening…"
											>
												Reopen pull request
											</LoadingButton>
										) : undefined
									}
								/>
							</>
						}
						aside={
							<>
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
								{pr.viewer.canParticipate && (
									<ThreadSubscriptionButton
										repoId={pr.repoId}
										number={pr.number}
									/>
								)}
							</>
						}
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
								repoId={repo?.id}
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
					<Suspense fallback={<Skeleton className="h-32" aria-busy="true" />}>
						<PullRequestFilesTab
							owner={owner}
							name={name}
							pr={pr}
							diff={diff}
							diffLoading={diffLoading}
						/>
					</Suspense>
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
			backTo="/$owner/$name/pulls"
			backParams={{ owner, name }}
			backLabel="Back to Pull Requests"
		/>
	);
}

function TabCount({ children }: { children: ReactNode }) {
	return (
		<span className="rounded-full bg-bjork-field-inset px-1.5 py-px font-mono text-[11px] text-bjork-text-medium tabular-nums">
			{children}
		</span>
	);
}
