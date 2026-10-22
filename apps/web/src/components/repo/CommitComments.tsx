import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { CommentCard } from "@/components/CommentCard";
import { CommentForm, SignInToComment } from "@/components/CommentForm";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	authSessionQueryOptions,
	commitCommentsQueryOptions,
	queryKeys,
} from "@/lib/query-options";
import {
	addCommitComment,
	editCommitComment,
	removeCommitComment,
} from "@/server/commit-comments";

/** GitHub's commit comments under a commit's diff: list, post, edit, delete. */
export function CommitComments({
	repoId,
	sha,
	owner,
	name,
}: {
	repoId: number;
	sha: string;
	owner: string;
	name: string;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [draft, setDraft] = useState("");
	const { data: session } = useQuery(authSessionQueryOptions());
	const pages = useInfiniteQuery(commitCommentsQueryOptions(repoId, sha));
	const comments = pages.data?.pages.flatMap((page) => page.comments) ?? [];
	const canComment = pages.data?.pages[0]?.canComment ?? false;

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.commitComments(repoId, sha),
		});
	const onError = (error: Error) => toast(error.message, "error");

	const create = useMutation({
		mutationFn: (body: string) =>
			addCommitComment({ data: { repoId, sha, body } }),
		onSuccess: async () => {
			setDraft("");
			await refresh();
		},
		onError,
	});
	const edit = useMutation({
		mutationFn: ({ commentId, body }: { commentId: number; body: string }) =>
			editCommitComment({ data: { repoId, commentId, body } }),
		onSuccess: refresh,
		onError,
	});
	const remove = useMutation({
		mutationFn: (commentId: number) =>
			removeCommitComment({ data: { repoId, commentId } }),
		onSuccess: refresh,
		onError,
	});

	return (
		<section className="space-y-4" aria-labelledby="commit-comments-heading">
			<h2
				id="commit-comments-heading"
				className="text-lg font-semibold text-foreground"
			>
				Comments {comments.length > 0 && `(${comments.length})`}
			</h2>
			{comments.map((comment) => (
				<div key={comment.id} id={`commitcomment-${comment.id}`}>
					<CommentCard
						comment={comment}
						owner={owner}
						name={name}
						repoId={repoId}
						onSave={
							comment.canEdit
								? (body) => edit.mutateAsync({ commentId: comment.id, body })
								: undefined
						}
						onDelete={
							comment.canEdit ? () => remove.mutate(comment.id) : undefined
						}
						isSaving={edit.isPending}
					/>
				</div>
			))}
			{pages.hasNextPage && (
				<Button
					variant="outline"
					onClick={() => void pages.fetchNextPage()}
					disabled={pages.isFetchingNextPage}
				>
					Load more comments
				</Button>
			)}
			{canComment ? (
				<CommentForm
					value={draft}
					onChange={setDraft}
					onSubmit={() => create.mutate(draft)}
					isPending={create.isPending}
				/>
			) : (
				!session?.user && pages.isSuccess && <SignInToComment />
			)}
		</section>
	);
}
