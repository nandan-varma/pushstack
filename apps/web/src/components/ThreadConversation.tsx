import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useState } from "react";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import {
	type ThreadComment,
	ThreadTimeline,
} from "@/components/timeline/ThreadTimeline";
import { useToast } from "@/components/toast-provider";
import { quoteForReply } from "@/lib/markdown-quote";
import { addPostedComment, authSessionQueryOptions } from "@/lib/query-options";
import { createComment } from "@/server/comments";

type ThreadTarget =
	| { issueId: number; pullRequestId?: never }
	| { pullRequestId: number; issueId?: never };

/** Keep draft and mutation state at page level so PR tab switches preserve them. */
export function useThreadComments({
	thread,
	commentsQueryKey,
}: {
	thread?: ThreadTarget;
	commentsQueryKey: readonly unknown[];
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const [draft, setDraft] = useState("");
	const commentMutation = useMutation({
		mutationFn: createComment,
		onSuccess: (created) => {
			setDraft("");
			const user = session?.user;
			if (user) {
				addPostedComment<ThreadComment>(queryClient, commentsQueryKey, {
					...created,
					author: {
						id: user.id,
						apiId: 0, // the web UI never shows it
						name: user.name,
						username: user.username ?? user.name,
						image: user.image ?? null,
					},
				});
			}
			toast("Comment posted", "success");
		},
		onError: (error: Error) =>
			toast(error.message || "Failed to post comment", "error"),
	});

	return {
		draft,
		setDraft,
		session,
		commentMutation,
		submit: () => {
			if (thread && draft.trim())
				commentMutation.mutate({ data: { ...thread, body: draft } });
		},
	};
}

type Props = Omit<
	ComponentProps<typeof ThreadTimeline>,
	"viewerId" | "onQuote"
> & {
	comments: ReturnType<typeof useThreadComments>;
};

export function ThreadConversation({ comments, ...timeline }: Props) {
	const { draft, setDraft, session, commentMutation, submit } = comments;

	return (
		<>
			<ThreadTimeline
				{...timeline}
				viewerId={session?.user?.id}
				onQuote={
					timeline.canParticipate
						? (body) => setDraft((value) => value + quoteForReply(body))
						: undefined
				}
			/>
			{timeline.canParticipate ? (
				<CommentForm
					value={draft}
					onChange={setDraft}
					onSubmit={submit}
					isPending={commentMutation.isPending}
				/>
			) : !session?.user ? (
				<SignInToComment />
			) : null}
		</>
	);
}
