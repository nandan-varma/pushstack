import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	isNotFound,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { EditableTitle } from "@/components/EditableTitle";
import { IssueAssignees } from "@/components/IssueAssignees";
import { NotFoundCard } from "@/components/NotFoundCard";
import { issueStatusVariant } from "@/components/status-variants";
import { ThreadLabels } from "@/components/ThreadLabels";
import { ThreadTimeline } from "@/components/timeline/ThreadTimeline";
import { useToast } from "@/components/toast-provider";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/loading-button";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { quoteForReply } from "@/lib/markdown-quote";
import {
	authSessionQueryOptions,
	issueByNumberQueryOptions,
	issueCommentsQueryOptions,
	loadThreadThroughEnd,
	pullRequestByNumberQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
	timelineQueryOptions,
} from "@/lib/query-options";
import { createComment } from "@/server/comments";
import { updateIssue } from "@/server/issues";

export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
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
				.catch(async (error: unknown) => {
					// Issues and pull requests share one number sequence: send a
					// number that belongs to a pull request to its page.
					if (!isNotFound(error)) throw error;
					const other = await queryClient
						.ensureQueryData(
							pullRequestByNumberQueryOptions({
								owner: params.owner,
								name: params.name,
								number: issueNumber,
							}),
						)
						.catch(() => null);
					if (other) {
						throw redirect({
							to: "/repo/$owner/$name/pulls/$id",
							params,
							statusCode: 301,
						});
					}
					throw error;
				}),
		]);

		// Comments are keyed by the issue's internal id, only known once the
		// issue itself has resolved — can't start this in parallel with it.
		if (issue) {
			await queryClient
				.ensureInfiniteQueryData(issueCommentsQueryOptions(issue.id))
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
	notFoundComponent: IssueNotFound,
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
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(issue.repoId),
				});
			}
		},
	});

	const commentMutation = useMutation({
		mutationFn: createComment,
		onSuccess: async () => {
			setNewComment("");
			if (issue) {
				await loadThreadThroughEnd(
					queryClient,
					issueCommentsQueryOptions(issue.id),
					timelineQueryOptions(issue.repoId, issue.number),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(issue.repoId),
				});
			}
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

	if (!issue) return <IssueNotFound />;

	// The mutations re-check both of these server-side; deriving the controls
	// from the same permissions is what keeps the page from offering an action
	// that can only fail.
	const canToggleStatus =
		issue.viewer.canWrite || session?.user?.id === issue.authorId;
	const canEdit = canToggleStatus;

	return (
		<div className="space-y-6">
			{/* Header */}
			<DetailHeader
				title={
					<EditableTitle
						title={issue.title}
						onSave={
							canEdit
								? (title) =>
										updateMutation.mutateAsync({
											data: { issueId: issue.id, title },
										})
								: undefined
						}
						isSaving={updateMutation.isPending}
					/>
				}
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
						by {issue.author.name}
					</p>
				}
				actions={
					<>
						<BackLink to="/repo/$owner/$name/issues" params={{ owner, name }} />
						{canToggleStatus && (
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

			<IssueAssignees
				issueId={issue.id}
				repoId={issue.repoId}
				assignees={issue.assignees.map((a) => a.user)}
				canEdit={issue.viewer.canWrite}
				onChanged={() => {
					queryClient.invalidateQueries({ queryKey: issueQueryKey });
					queryClient.invalidateQueries({
						queryKey: queryKeys.repoIssuesRoot(issue.repoId),
					});
					queryClient.invalidateQueries({
						queryKey: queryKeys.timelineRoot(issue.repoId),
					});
				}}
			/>

			{/* Issue Body */}
			<CommentCard
				comment={issue}
				owner={owner}
				name={name}
				repoId={issue.repoId}
				allowEmpty
				isSaving={updateMutation.isPending}
				onSave={
					canEdit
						? (body) =>
								updateMutation.mutateAsync({
									data: { issueId: issue.id, body },
								})
						: undefined
				}
			/>

			<ThreadLabels
				owner={owner}
				name={name}
				repoId={issue.repoId}
				number={issue.number}
				labels={issue.labels}
				canEdit={issue.viewer.canWrite}
			/>

			<ThreadTimeline
				owner={owner}
				name={name}
				repoId={issue.repoId}
				number={issue.number}
				commentsOptions={issueCommentsQueryOptions(issue.id)}
				viewerId={session?.user?.id}
				canParticipate={issue.viewer.canParticipate}
				canModerate={issue.viewer.canWrite}
				onQuote={
					issue.viewer.canParticipate
						? (body) => setNewComment((draft) => draft + quoteForReply(body))
						: undefined
				}
			/>

			{/* Add Comment */}
			{issue.viewer.canParticipate ? (
				<CommentForm
					value={newComment}
					onChange={setNewComment}
					onSubmit={handleAddComment}
					isPending={commentMutation.isPending}
				/>
			) : !session?.user ? (
				<SignInToComment />
			) : null}
		</div>
	);
}

function IssueNotFound() {
	const { owner, name } = Route.useParams();
	return (
		<NotFoundCard
			title="Issue Not Found"
			backTo="/repo/$owner/$name/issues"
			backParams={{ owner, name }}
			backLabel="Back to Issues"
		/>
	);
}
