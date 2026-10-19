import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
	CircleCheck,
	CircleDot,
	GitBranch,
	GitMerge,
	type LucideIcon,
	MessageSquareQuote,
	Pencil,
} from "lucide-react";
import { CommentCard } from "@/components/CommentCard";
import { useToast } from "@/components/toast-provider";
import { queryKeys, timelineQueryOptions } from "@/lib/query-options";
import type { ThreadRef, TimelineEntry } from "@/lib/timeline-types";
import { deleteComment, updateComment } from "@/server/comments";

type Comment = Parameters<typeof CommentCard>[0]["comment"] & {
	authorId: string;
};

/**
 * An issue's or pull request's conversation as GitHub shows it: comments and
 * events (closed, reopened, merged, mentions) in one chronological column.
 */
export function ThreadTimeline({
	owner,
	name,
	repoId,
	number,
	comments,
	onQuote,
	viewerId,
	canParticipate,
	canModerate,
	commentsQueryKey,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	comments: Comment[];
	/** Called with a comment's body when its "Quote reply" is used. */
	onQuote?: (body: string) => void;
	/** The signed-in user, if any: their own comments get Edit and Delete. */
	viewerId?: string;
	canParticipate: boolean;
	/** Write collaborators may edit and delete anyone's comments. */
	canModerate: boolean;
	/** The comments query to refresh after an edit or delete. */
	commentsQueryKey: readonly unknown[];
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: commentsQueryKey });
		queryClient.invalidateQueries({ queryKey: queryKeys.timelineRoot(repoId) });
	};
	const updateMutation = useMutation({
		mutationFn: updateComment,
		onSuccess: refresh,
		onError: (err: Error) => toast(err.message || "Failed to edit", "error"),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteComment,
		onSuccess: () => {
			refresh();
			toast("Comment deleted", "success");
		},
		onError: (err: Error) => toast(err.message || "Failed to delete", "error"),
	});
	const { data: events = [] } = useQuery(timelineQueryOptions(repoId, number));
	const items = [
		...comments.map((comment) => ({ kind: "comment" as const, comment })),
		...events.map((event) => ({ kind: "event" as const, event })),
	].sort(
		(a, b) => new Date(itemTime(a)).getTime() - new Date(itemTime(b)).getTime(),
	);

	if (items.length === 0) return null;
	return (
		<div className="space-y-4">
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
		</div>
	);
}

function itemTime(
	item:
		| { kind: "comment"; comment: Comment }
		| { kind: "event"; event: TimelineEntry },
) {
	return item.kind === "comment"
		? item.comment.createdAt
		: item.event.createdAt;
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
					? "/repo/$owner/$name/issues/$id"
					: "/repo/$owner/$name/pulls/$id"
			}
			params={{ owner, name, id: String(thread.number) }}
			className="font-medium text-foreground hover:underline"
		>
			{thread.title} #{thread.number}
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
				) : (
					"closed this"
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
							to="/repo/$owner/$name/commit/$sha"
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
		case "head_ref_deleted":
			return {
				icon: GitBranch,
				text: (
					<>
						deleted the <code className="font-mono">{event.branch}</code> branch
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
		<div className="flex items-center gap-3 px-6 text-sm text-muted-foreground">
			<span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
				<Icon className="size-3.5" />
			</span>
			<p className="min-w-0">
				<Link
					to="/users/$username"
					params={{ username: event.actor.username }}
					className="font-medium text-foreground hover:underline"
				>
					{event.actor.username}
				</Link>{" "}
				{text}{" "}
				<time dateTime={new Date(event.createdAt).toISOString()}>
					{formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
				</time>
			</p>
		</div>
	);
}
