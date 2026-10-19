import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	isNotFound,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { lazy, Suspense, useState } from "react";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import {
	AvatarBodySkeleton,
	DetailHeader,
	DetailHeaderSkeleton,
} from "@/components/DetailHeader";
import { NotFoundCard } from "@/components/NotFoundCard";
import { issueStatusVariant } from "@/components/status-variants";
import { ThreadTimeline } from "@/components/timeline/ThreadTimeline";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { quoteForReply } from "@/lib/markdown-quote";
import {
	authSessionQueryOptions,
	issueByNumberQueryOptions,
	issueCommentsQueryOptions,
	pullRequestByNumberQueryOptions,
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
				await queryClient.invalidateQueries({
					queryKey: queryKeys.issueComments(issue.id),
				});
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
								{issue.author.name}
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

			<ThreadTimeline
				owner={owner}
				name={name}
				repoId={issue.repoId}
				number={issue.number}
				comments={comments ?? []}
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
