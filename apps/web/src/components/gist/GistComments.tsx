import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { CommentForm } from "@/components/CommentForm";
import { Panel } from "@/components/layout/panel";
import { RelativeTime } from "@/components/RelativeTime";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-options";
import { createGistComment, deleteGistComment } from "@/server/gists";

export interface GistComment {
	id: number;
	body: string;
	createdAt: string;
	author: { username: string; name: string | null; image: string | null };
	canDelete: boolean;
}

export function GistComments({
	owner,
	id,
	comments,
	signedIn,
}: {
	owner: string;
	id: string;
	comments: readonly GistComment[];
	signedIn: boolean;
}) {
	const [body, setBody] = useState("");
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.gistsRoot });

	const create = useMutation({
		mutationFn: createGistComment,
		onSuccess: () => {
			setBody("");
			void refresh();
		},
		onError: (error: Error) => toast(error.message, "error"),
	});
	const remove = useMutation({
		mutationFn: deleteGistComment,
		onSuccess: () => void refresh(),
		onError: (error: Error) => toast(error.message, "error"),
	});

	return (
		<div className="space-y-4">
			{comments.map((comment) => (
				<Panel key={comment.id} className="px-5 py-4">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2 text-sm">
							<Link
								to="/$owner"
								params={{ owner: comment.author.username }}
								className="font-semibold hover:underline"
							>
								{comment.author.username}
							</Link>
							<span className="text-bjork-text-muted">
								<RelativeTime date={comment.createdAt} />
							</span>
						</div>
						{comment.canDelete && (
							<Button
								variant="ghost"
								size="sm"
								aria-label="Delete comment"
								disabled={remove.isPending}
								onClick={() =>
									remove.mutate({ data: { owner, id, commentId: comment.id } })
								}
							>
								<Trash2 aria-hidden="true" className="h-4 w-4" />
							</Button>
						)}
					</div>
					<p className="mt-2 whitespace-pre-wrap text-sm text-bjork-text">
						{comment.body}
					</p>
				</Panel>
			))}
			{signedIn ? (
				<CommentForm
					value={body}
					onChange={setBody}
					isPending={create.isPending}
					disabled={!body.trim()}
					onSubmit={() =>
						create.mutate({ data: { owner, id, body: body.trim() } })
					}
				/>
			) : (
				<p className="text-sm text-bjork-text-muted">
					<Link to="/login" className="underline">
						Sign in
					</Link>{" "}
					to comment on this gist.
				</p>
			)}
		</div>
	);
}
