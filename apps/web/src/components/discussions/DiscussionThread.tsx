import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	authSessionQueryOptions,
	discussionByNumberQueryOptions,
	discussionCommentsQueryOptions,
} from "@/lib/query-options";
import type {
	DiscussionCommentView,
	DiscussionView,
} from "@/server/discussions";
import {
	commentOnDiscussion,
	markDiscussionAnswer,
	toggleDiscussionUpvote,
} from "@/server/discussions";

function UpvoteButton({
	count,
	upvoted,
	disabled,
	onToggle,
	isPending,
}: {
	count: number;
	upvoted: boolean;
	disabled: boolean;
	onToggle: () => void;
	isPending: boolean;
}) {
	return (
		<Button
			variant={upvoted ? "default" : "outline"}
			size="sm"
			disabled={disabled || isPending}
			onClick={onToggle}
			aria-pressed={upvoted}
		>
			▲ {count} {upvoted ? "Upvoted" : "Upvote"}
		</Button>
	);
}

function AnswerBadge() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-bjork-accent-soft px-2 py-0.5 text-xs font-medium text-bjork-accent">
			<CircleCheck aria-hidden="true" /> Answer
		</span>
	);
}

/** `/{owner}/{repo}/discussions/{n}`: the post, its upvote, comments and answer. */
export function DiscussionThread({
	owner,
	name,
	discussion,
	canParticipate,
	canWrite,
}: {
	owner: string;
	name: string;
	discussion: DiscussionView;
	canParticipate: boolean;
	canWrite: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const commentsOptions = discussionCommentsQueryOptions(discussion.id);
	const comments = useInfiniteQuery(commentsOptions);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<number | null>(null);
	const [replyDraft, setReplyDraft] = useState("");

	const discussionKey = discussionByNumberQueryOptions({
		owner,
		name,
		number: discussion.number,
	}).queryKey;

	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: discussionKey });
		queryClient.invalidateQueries({ queryKey: commentsOptions.queryKey });
	};

	const upvote = useMutation({
		mutationFn: toggleDiscussionUpvote,
		onSuccess: refresh,
		onError: (error: Error) =>
			toast(error.message || "Couldn't upvote", "error"),
	});
	const comment = useMutation({
		mutationFn: commentOnDiscussion,
		onSuccess: () => {
			setDraft("");
			setReplyDraft("");
			setReplyTo(null);
			refresh();
		},
		onError: (error: Error) =>
			toast(error.message || "Couldn't post the comment", "error"),
	});
	const answer = useMutation({
		mutationFn: markDiscussionAnswer,
		onSuccess: refresh,
		onError: (error: Error) =>
			toast(error.message || "Couldn't mark the answer", "error"),
	});

	const isQa = discussion.category.format === "q_and_a";
	const canChooseAnswer =
		isQa &&
		canParticipate &&
		(session?.user?.id === discussion.author.id || canWrite);

	const pages = useMemo(
		() => comments.data?.pages.flat() ?? [],
		[comments.data],
	);

	const answerControl = (item: DiscussionCommentView) =>
		canChooseAnswer ? (
			<Button
				variant="ghost"
				size="sm"
				disabled={answer.isPending}
				onClick={() =>
					answer.mutate({
						data: { commentId: item.id, answered: !item.isAnswer },
					})
				}
			>
				{item.isAnswer ? "Unmark answer" : "Mark as answer"}
			</Button>
		) : item.isAnswer ? (
			<AnswerBadge />
		) : null;

	const replyForm = (item: DiscussionCommentView) =>
		replyTo === item.id ? (
			<CommentForm
				value={replyDraft}
				onChange={setReplyDraft}
				onSubmit={() =>
					comment.mutate({
						data: {
							discussionId: discussion.id,
							body: replyDraft,
							replyToId: item.id,
						},
					})
				}
				isPending={comment.isPending}
			/>
		) : null;

	return (
		<div className="space-y-4">
			<CommentCard
				comment={discussion}
				owner={owner}
				name={name}
				repoId={discussion.repoId}
				allowEmpty
				footer={
					<div className="flex flex-wrap items-center gap-2">
						<UpvoteButton
							count={discussion.upvoteCount}
							upvoted={discussion.viewerHasUpvoted}
							disabled={!canParticipate}
							isPending={upvote.isPending}
							onToggle={() =>
								upvote.mutate({
									data: {
										discussionId: discussion.id,
										upvoted: !discussion.viewerHasUpvoted,
									},
								})
							}
						/>
						<span className="text-xs text-bjork-text-soft">
							{discussion.category.emoji} {discussion.category.name}
						</span>
					</div>
				}
			/>

			{comments.isLoading ? (
				<p className="text-sm text-bjork-text-soft">Loading comments…</p>
			) : (
				pages.map((item) => (
					<div key={item.id} className="space-y-2">
						<CommentCard
							comment={item}
							owner={owner}
							name={name}
							repoId={discussion.repoId}
							footer={
								<div className="flex flex-wrap items-center gap-2">
									{item.isAnswer && <AnswerBadge />}
									{answerControl(item)}
									{canParticipate && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setReplyTo(replyTo === item.id ? null : item.id)
											}
										>
											Reply
										</Button>
									)}
								</div>
							}
						/>
						{item.replies.length > 0 && (
							<div className="ml-8 space-y-2 border-l border-bjork-border-muted pl-4">
								{item.replies.map((reply) => (
									<CommentCard
										key={reply.id}
										comment={reply}
										owner={owner}
										name={name}
										repoId={discussion.repoId}
										footer={
											<div className="flex flex-wrap items-center gap-2">
												{reply.isAnswer && <AnswerBadge />}
												{answerControl(reply)}
											</div>
										}
									/>
								))}
							</div>
						)}
						{replyForm(item)}
					</div>
				))
			)}

			{canParticipate ? (
				<CommentForm
					value={draft}
					onChange={setDraft}
					onSubmit={() =>
						comment.mutate({
							data: { discussionId: discussion.id, body: draft },
						})
					}
					isPending={comment.isPending}
					disabled={discussion.locked}
				/>
			) : (
				<SignInToComment />
			)}
		</div>
	);
}
