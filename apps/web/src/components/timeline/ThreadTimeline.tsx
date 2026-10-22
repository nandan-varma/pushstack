import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CircleCheck,
	CircleDot,
	CircleX,
	GitBranch,
	GitCommitHorizontal,
	GitMerge,
	type LucideIcon,
	MessageSquare,
	MessageSquareQuote,
	Pencil,
	Tag,
	UserRound,
} from "lucide-react";
import { CommentCard } from "@/components/CommentCard";
import { LabelChip } from "@/components/LabelChip";
import { ReactionBar } from "@/components/ReactionBar";
import { RelativeTime } from "@/components/RelativeTime";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	type issueCommentsQueryOptions,
	postedCommentsQueryOptions,
	queryKeys,
	timelineQueryOptions,
} from "@/lib/query-options";
import { mergeThreadItems } from "@/lib/thread-merge";
import type { ThreadRef, TimelineEntry } from "@/lib/timeline-types";
import type { getComments } from "@/server/comments";
import { deleteComment, updateComment } from "@/server/comments";

export type ThreadComment = Awaited<ReturnType<typeof getComments>>[number];

export function ThreadTimeline({
	owner,
	name,
	repoId,
	number,
	commentsOptions,
	onQuote,
	viewerId,
	canParticipate,
	canModerate,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	commentsOptions: ReturnType<typeof issueCommentsQueryOptions>;
	onQuote?: (body: string) => void;
	/** The signed-in user, if any: their own comments get Edit and Delete. */
	viewerId?: string;
	canParticipate: boolean;
	/** Write collaborators may edit and delete anyone's comments. */
	canModerate: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const postedOptions = postedCommentsQueryOptions<ThreadComment>(
		commentsOptions.queryKey,
	);
	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: commentsOptions.queryKey });
		queryClient.invalidateQueries({ queryKey: queryKeys.timelineRoot(repoId) });
	};
	const updateMutation = useMutation({
		mutationFn: updateComment,
		onSuccess: (_, { data }) => {
			queryClient.setQueryData(postedOptions.queryKey, (posted = []) =>
				posted.map((c) =>
					c.id === data.commentId
						? { ...c, body: data.body, editedAt: new Date() }
						: c,
				),
			);
			refresh();
		},
		onError: (err: Error) => toast(err.message || "Failed to edit", "error"),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteComment,
		onSuccess: (_, { data }) => {
			queryClient.setQueryData(postedOptions.queryKey, (posted = []) =>
				posted.filter((c) => c.id !== data.commentId),
			);
			refresh();
			toast("Comment deleted", "success");
		},
		onError: (err: Error) => toast(err.message || "Failed to delete", "error"),
	});
	const commentPages = useInfiniteQuery(commentsOptions);
	const eventPages = useInfiniteQuery(timelineQueryOptions(repoId, number));
	const sources = [commentPages, eventPages];
	const { data: posted } = useQuery(postedOptions);
	const { items, hasMore } = mergeThreadItems(
		{
			loaded: commentPages.data?.pages.flat() ?? [],
			hasMore: commentPages.hasNextPage,
		},
		{
			loaded: eventPages.data?.pages.flat() ?? [],
			hasMore: eventPages.hasNextPage,
		},
		posted,
	);
	const loadingMore = sources.some((query) => query.isFetchingNextPage);

	if (items.length === 0 && !hasMore) return null;
	// A rule runs down behind the events, joining the thread into one column.
	return (
		<div className="relative space-y-4 before:absolute before:inset-y-0 before:left-[33px] before:w-px before:bg-bjork-border">
			{items.map((item) =>
				item.kind === "comment" ? (
					<CommentCard
						key={`comment-${item.comment.id}`}
						comment={item.comment}
						owner={owner}
						name={name}
						repoId={repoId}
						onQuote={onQuote}
						{...(canModerate ||
						(canParticipate && item.comment.authorId === viewerId)
							? {
									onSave: (body: string) =>
										updateMutation.mutateAsync({
											data: { commentId: item.comment.id, body },
										}),
									onDelete: () =>
										deleteMutation.mutate({
											data: { commentId: item.comment.id },
										}),
									isSaving: updateMutation.isPending,
								}
							: {})}
						footer={
							<ReactionBar
								repoId={repoId}
								number={number}
								commentId={item.comment.id}
								canReact={canParticipate}
							/>
						}
					/>
				) : (
					<TimelineEventRow
						key={`event-${item.event.id}`}
						event={item.event}
						owner={owner}
						name={name}
					/>
				),
			)}
			{hasMore && (
				<Button
					variant="outline"
					className="w-full"
					disabled={loadingMore}
					onClick={() => {
						for (const query of sources) {
							if (query.hasNextPage) void query.fetchNextPage();
						}
					}}
				>
					{loadingMore ? "Loading…" : "Load more"}
				</Button>
			)}
		</div>
	);
}

function ThreadLink({
	thread,
	owner,
	name,
}: {
	thread: ThreadRef;
	owner: string;
	name: string;
}) {
	return (
		<Link
			to={
				thread.kind === "issue"
					? "/$owner/$name/issues/$id"
					: "/$owner/$name/pulls/$id"
			}
			params={{ owner, name, id: String(thread.number) }}
			className="font-medium text-foreground hover:underline"
		>
			{thread.title} #{thread.number}
		</Link>
	);
}

function CommitLink({
	sha,
	owner,
	name,
}: {
	sha: string;
	owner: string;
	name: string;
}) {
	return (
		<Link
			to="/$owner/$name/commit/$sha"
			params={{ owner, name, sha }}
			className="font-mono text-foreground hover:underline"
		>
			{sha.slice(0, 7)}
		</Link>
	);
}

function describe(
	event: TimelineEntry,
	owner: string,
	name: string,
): { icon: LucideIcon; text: React.ReactNode } {
	switch (event.event) {
		case "closed":
			return {
				icon: CircleCheck,
				text: event.closer ? (
					<>
						closed this as completed in{" "}
						<ThreadLink thread={event.closer} owner={owner} name={name} />
					</>
				) : event.commitSha ? (
					<>
						closed this as completed in commit{" "}
						<CommitLink sha={event.commitSha} owner={owner} name={name} />
					</>
				) : (
					"closed this"
				),
			};
		case "referenced":
			return {
				icon: GitCommitHorizontal,
				text: (
					<>
						referenced this in commit{" "}
						<CommitLink sha={event.commitSha} owner={owner} name={name} />
						{event.message ? <> {event.message}</> : null}
					</>
				),
			};
		case "reopened":
			return { icon: CircleDot, text: "reopened this" };
		case "merged":
			return {
				icon: GitMerge,
				text: (
					<>
						merged commit{" "}
						<Link
							to="/$owner/$name/commit/$sha"
							params={{ owner, name, sha: event.commitSha }}
							className="font-mono text-foreground hover:underline"
						>
							{event.commitSha.slice(0, 7)}
						</Link>{" "}
						into <code className="font-mono">{event.base}</code>
					</>
				),
			};
		case "cross-referenced":
			return {
				icon: MessageSquareQuote,
				text: (
					<>
						mentioned this in{" "}
						{event.source.kind === "issue" ? "issue" : "pull request"}{" "}
						<ThreadLink thread={event.source} owner={owner} name={name} />
					</>
				),
			};
		case "labeled":
		case "unlabeled":
			return {
				icon: Tag,
				text: (
					<>
						{event.event === "labeled" ? "added the" : "removed the"}{" "}
						<LabelChip name={event.label.name} color={event.label.color} />{" "}
						label
					</>
				),
			};
		case "head_ref_deleted":
			return {
				icon: GitBranch,
				text: (
					<>
						deleted the <code className="font-mono">{event.branch}</code> branch
					</>
				),
			};
		case "assigned":
		case "unassigned":
			return {
				icon: UserRound,
				text: (
					<>
						{event.event === "assigned" ? "assigned" : "unassigned"}{" "}
						<Link
							to="/$owner"
							params={{ owner: event.assignee.username }}
							className="font-medium text-foreground"
						>
							{event.assignee.username}
						</Link>
					</>
				),
			};
		case "renamed":
			return {
				icon: Pencil,
				text: (
					<>
						changed the title <s>{event.from}</s> <b>{event.to}</b>
					</>
				),
			};
		case "reviewed":
			return event.state === "approved"
				? { icon: CircleCheck, text: "approved these changes" }
				: event.state === "changes_requested"
					? { icon: CircleX, text: "requested changes" }
					: { icon: MessageSquare, text: "reviewed" };
	}
}

function TimelineEventRow({
	event,
	owner,
	name,
}: {
	event: TimelineEntry;
	owner: string;
	name: string;
}) {
	const { icon: Icon, text } = describe(event, owner, name);
	return (
		<div className="relative flex min-h-9 items-center gap-3 px-5 text-[13px] text-bjork-text-muted">
			<span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-bjork-border bg-bjork-surface-active text-bjork-text-soft">
				<Icon className="size-3.5" />
			</span>
			<p className="min-w-0">
				<Link
					to="/$owner"
					params={{ owner: event.actor.username }}
					className="font-medium text-bjork-text hover:underline"
				>
					{event.actor.username}
				</Link>{" "}
				{text} <RelativeTime date={event.createdAt} />
			</p>
		</div>
	);
}
