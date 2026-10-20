import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SmilePlus } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { threadReactionsQueryOptions } from "@/lib/query-options";
import {
	emptyReactionSummary,
	REACTION_CONTENTS,
	REACTION_EMOJI,
	type ReactionContent,
} from "@/lib/reactions";
import { cn } from "@/lib/utils";
import { toggleReaction } from "@/server/reactions";

/**
 * GitHub's reaction row under an issue, pull request or comment: one pill per
 * content with a count (highlighted when the viewer reacted), plus a picker for
 * signed-in readers. All of a thread's bars share one query.
 */
export function ReactionBar({
	repoId,
	number,
	commentId,
	canReact,
}: {
	repoId: number;
	number: number;
	/** Absent for the issue or pull request itself. */
	commentId?: number;
	canReact: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const options = threadReactionsQueryOptions(repoId, number);
	const { data } = useQuery(options);
	const summary =
		(commentId === undefined ? data?.issue : data?.comments[commentId]) ??
		emptyReactionSummary();
	const viewer = new Set(summary.viewerReactions);

	const mutation = useMutation({
		mutationFn: (content: ReactionContent) =>
			toggleReaction({
				data: {
					repoId,
					number,
					commentId,
					content,
					reacted: !viewer.has(content),
				},
			}),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: options.queryKey }),
		onError: (err: Error) =>
			toast(err.message || "Couldn't update reaction", "error"),
	});

	const shown = REACTION_CONTENTS.filter((c) => summary.reactions[c] > 0);
	if (shown.length === 0 && !canReact) return null;

	return (
		<div className="mt-4 flex flex-wrap items-center gap-1.5">
			{canReact && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="h-7 rounded-full px-2 text-muted-foreground"
							aria-label="Add reaction"
						>
							<SmilePlus className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="flex w-auto gap-1">
						{REACTION_CONTENTS.map((content) => (
							<DropdownMenuItem
								key={content}
								aria-label={content}
								className={cn(
									"justify-center px-2 text-lg",
									viewer.has(content) && "bg-accent",
								)}
								onClick={() => mutation.mutate(content)}
							>
								{REACTION_EMOJI[content]}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{shown.map((content) => (
				<Button
					key={content}
					variant="outline"
					size="sm"
					aria-label={`${content} reaction, ${summary.reactions[content]}`}
					aria-pressed={viewer.has(content)}
					disabled={!canReact || mutation.isPending}
					className={cn(
						"h-7 gap-1 rounded-full px-2 text-xs",
						viewer.has(content) &&
							"border-primary/50 bg-primary/10 text-foreground",
					)}
					onClick={() => mutation.mutate(content)}
				>
					<span>{REACTION_EMOJI[content]}</span>
					{summary.reactions[content]}
				</Button>
			))}
		</div>
	);
}
