import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CircleCheck, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { CommentCard } from "@/components/CommentCard";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { useEditableTitle } from "@/components/EditableTitle";
import { IssueAssignees } from "@/components/IssueAssignees";
import { SplitLayout } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { ReactionBar } from "@/components/ReactionBar";
import { RelativeTime } from "@/components/RelativeTime";
import { StatePill } from "@/components/StatePill";
import {
	ThreadConversation,
	useThreadComments,
} from "@/components/ThreadConversation";
import { ThreadLabels } from "@/components/ThreadLabels";
import { ThreadSubscriptionButton } from "@/components/ThreadSubscriptionButton";
import { LoadingButton } from "@/components/ui/loading-button";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { contentQuery } from "@/lib/prefetch";
import {
	authSessionQueryOptions,
	issueByNumberQueryOptions,
	issueCommentsQueryOptions,
	pullRequestByNumberQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
	threadReactionsQueryOptions,
} from "@/lib/query-options";
import { ensureThreadNumberRedirect } from "@/lib/thread-number-redirect";
import { type getIssueByNumber, updateIssue } from "@/server/issues";

export const Route = createFileRoute("/$owner/$name/issues/$id")({
	loader: async ({ params, context: { queryClient } }) => {
		const issueNumber = Number(params.id);
		if (!Number.isInteger(issueNumber) || issueNumber < 1) throw notFound();
		// getIssueByNumber resolves the repo server-side, so this can still run
		// in parallel with the repo query below rather than waiting on it.
		const [repo, issue] = await Promise.all([
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
			queryClient
				.ensureQueryData(
					issueByNumberQueryOptions({
						owner: params.owner,
						name: params.name,
						number: issueNumber,
					}),
				)
				.catch((error: unknown) =>
					ensureThreadNumberRedirect(
						error,
						params,
						() =>
							queryClient.ensureQueryData(
								pullRequestByNumberQueryOptions({
									owner: params.owner,
									name: params.name,
									number: issueNumber,
								}),
							),
						"/$owner/$name/pulls/$id",
					),
				),
		]);

		// Comments are keyed by the issue's internal id, only known once the
		// issue itself has resolved — can't start this in parallel with it.
		if (issue) {
			await Promise.all([
				queryClient
					.ensureInfiniteQueryData(issueCommentsQueryOptions(issue.id))
					.catch(() => {}),
				queryClient
					.ensureQueryData(
						threadReactionsQueryOptions(issue.repoId, issue.number),
					)
					.catch(() => {}),
			]);
		}

		// MarkdownRenderer (issue body + comments) resolves `#123` references
		// using these — fire-and-forget so the extra round trip doesn't land
		// after the body has already rendered.
		if (repo) {
			await Promise.all([
				contentQuery(queryClient, repositoryIssueNumbersQueryOptions(repo.id)),
				contentQuery(
					queryClient,
					repositoryPullRequestNumbersQueryOptions(repo.id),
				),
			]);
		}
	},
	component: IssueDetailPage,
	notFoundComponent: IssueNotFound,
});

function IssueDetailPage() {
	const { owner, name, id } = Route.useParams();
	const queryClient = useQueryClient();

	const { data: session } = useQuery(authSessionQueryOptions());
	const issueNumber = Number(id);
	const { data: issue, isLoading } = useQuery(
		issueByNumberQueryOptions({ owner, name, number: issueNumber }),
	);

	const comments = useThreadComments({
		thread: issue ? { issueId: issue.id } : undefined,
		commentsQueryKey: issueCommentsQueryOptions(issue?.id ?? 0).queryKey,
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
			if (issue) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(issue.repoId),
				});
				// The sidebar shows open counts from the repository row.
				queryClient.invalidateQueries({
					queryKey: queryKeys.repositoryByName(owner, name),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(issue.repoId),
				});
			}
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

	if (isLoading) {
		return (
			<div>
				<DetailHeaderSkeleton />
				<SplitLayout main={<AvatarBodySkeleton />} />
			</div>
		);
	}

	if (!issue) return <IssueNotFound />;

	const canToggleStatus =
		issue.viewer.canWrite || session?.user?.id === issue.authorId;
	const canEdit = canToggleStatus;

	const toggleStatusButton = canToggleStatus && (
		<LoadingButton
			variant="outline"
			onClick={handleToggleStatus}
			isLoading={updateMutation.isPending}
			loadingLabel={issue.status === "open" ? "Closing…" : "Reopening…"}
		>
			{issue.status === "open" ? (
				<CircleCheck aria-hidden="true" className="text-merged" />
			) : (
				<CircleDot aria-hidden="true" className="text-success" />
			)}
			{issue.status === "open" ? "Close issue" : "Reopen issue"}
		</LoadingButton>
	);

	return (
		<IssueDetail
			issue={issue}
			canEdit={canEdit}
			isSaving={updateMutation.isPending}
			onSaveTitle={(title) =>
				updateMutation.mutateAsync({ data: { issueId: issue.id, title } })
			}
			onSaveBody={(body) =>
				updateMutation.mutateAsync({ data: { issueId: issue.id, body } })
			}
			onAssigneesChanged={() => {
				queryClient.invalidateQueries({ queryKey: issueQueryKey });
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(issue.repoId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(issue.repoId),
				});
			}}
			comments={comments}
			toggleStatusButton={toggleStatusButton}
		/>
	);
}

type LoadedIssue = NonNullable<Awaited<ReturnType<typeof getIssueByNumber>>>;

function IssueDetail({
	issue,
	canEdit,
	isSaving,
	onSaveTitle,
	onSaveBody,
	onAssigneesChanged,
	comments,
	toggleStatusButton,
}: {
	issue: LoadedIssue;
	canEdit: boolean;
	isSaving: boolean;
	onSaveTitle: (title: string) => Promise<unknown>;
	onSaveBody: (body: string) => Promise<unknown>;
	onAssigneesChanged: () => void;
	comments: ReturnType<typeof useThreadComments>;
	toggleStatusButton: ReactNode;
}) {
	const { owner, name } = Route.useParams();
	const { titleNode, editButton } = useEditableTitle({
		title: issue.title,
		onSave: canEdit ? onSaveTitle : undefined,
		isSaving,
	});

	return (
		<div>
			<DetailHeader
				title={titleNode}
				number={issue.number}
				badge={<StatePill kind="issue" status={issue.status} />}
				meta={
					<p>
						<span className="font-medium text-bjork-text">
							{issue.author.name}
						</span>{" "}
						opened this issue <RelativeTime date={issue.createdAt} />
					</p>
				}
				actions={editButton}
			/>

			<SplitLayout
				main={
					<>
						<CommentCard
							comment={issue}
							owner={owner}
							name={name}
							repoId={issue.repoId}
							allowEmpty
							isSaving={isSaving}
							onSave={canEdit ? onSaveBody : undefined}
							footer={
								<ReactionBar
									repoId={issue.repoId}
									number={issue.number}
									canReact={issue.viewer.canParticipate}
								/>
							}
						/>
						<ThreadConversation
							owner={owner}
							name={name}
							repoId={issue.repoId}
							number={issue.number}
							comments={comments}
							commentsOptions={issueCommentsQueryOptions(issue.id)}
							canParticipate={issue.viewer.canParticipate}
							canModerate={issue.viewer.canWrite}
							composerAction={toggleStatusButton}
						/>
						{!issue.viewer.canParticipate && toggleStatusButton}
					</>
				}
				aside={
					<>
						<IssueAssignees
							issueId={issue.id}
							repoId={issue.repoId}
							assignees={issue.assignees.map((a) => a.user)}
							canEdit={issue.viewer.canWrite}
							onChanged={onAssigneesChanged}
						/>
						<ThreadLabels
							owner={owner}
							name={name}
							repoId={issue.repoId}
							number={issue.number}
							labels={issue.labels}
							canEdit={issue.viewer.canWrite}
						/>
						{issue.viewer.canParticipate && (
							<ThreadSubscriptionButton
								repoId={issue.repoId}
								number={issue.number}
							/>
						)}
					</>
				}
			/>
		</div>
	);
}

function IssueNotFound() {
	const { owner, name } = Route.useParams();
	return (
		<NotFoundCard
			title="Issue Not Found"
			backTo="/$owner/$name/issues"
			backParams={{ owner, name }}
			backLabel="Back to Issues"
		/>
	);
}
