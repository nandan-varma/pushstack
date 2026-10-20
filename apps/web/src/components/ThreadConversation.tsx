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

type Props = Omit<
	ComponentProps<typeof ThreadTimeline>,
	"viewerId" | "onQuote"
> & {
	thread:
		| { issueId: number; pullRequestId?: never }
		| { pullRequestId: number; issueId?: never };
};

/** Shared conversation and reply draft, including quoted replies and posted comments. */
export function ThreadConversation({ thread, ...timeline }: Props) {
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
				addPostedComment<ThreadComment>(
					queryClient,
					timeline.commentsOptions.queryKey,
					{
						...created,
						author: {
							id: user.id,
							apiId: 0, // the web UI never shows it
							name: user.name,
							username: user.username ?? user.name,
							image: user.image ?? null,
						},
					},
				);
			}
			toast("Comment posted", "success");
		},
		onError: (error: Error) =>
			toast(error.message || "Failed to post comment", "error"),
	});

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
					onSubmit={() => {
						if (draft.trim())
							commentMutation.mutate({ data: { ...thread, body: draft } });
					}}
					isPending={commentMutation.isPending}
				/>
			) : !session?.user ? (
				<SignInToComment />
			) : null}
		</>
	);
}
