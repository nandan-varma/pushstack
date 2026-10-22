import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Panel, PanelFooter } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The reply box at the foot of a thread. `secondaryAction` sits beside the
 * submit button — GitHub puts "Close issue" there, so finishing a thread and
 * leaving a last word happen in one place.
 */
export function CommentForm({
	value,
	onChange,
	onSubmit,
	isPending,
	disabled,
	secondaryAction,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	isPending?: boolean;
	disabled?: boolean;
	secondaryAction?: ReactNode;
}) {
	return (
		<Panel aria-labelledby="comment-form-heading">
			<h2 id="comment-form-heading" className="sr-only">
				Add a comment
			</h2>
			<div className="p-3">
				<Textarea
					aria-labelledby="comment-form-heading"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							(event.metaKey || event.ctrlKey) &&
							value.trim() &&
							!disabled
						) {
							event.preventDefault();
							onSubmit();
						}
					}}
					placeholder="Leave a comment"
					rows={5}
					className="min-h-32"
				/>
			</div>
			<PanelFooter className="justify-between">
				<p className="text-xs text-bjork-text-soft">
					Markdown supported · <kbd className="font-sans">⌘</kbd>
					<kbd className="font-sans">↵</kbd> to post
				</p>
				<div className="flex flex-wrap items-center gap-2">
					{secondaryAction}
					<LoadingButton
						onClick={onSubmit}
						disabled={!value.trim() || disabled}
						isLoading={isPending}
						loadingLabel="Posting…"
					>
						Comment
					</LoadingButton>
				</div>
			</PanelFooter>
		</Panel>
	);
}

export function SignInToComment() {
	return (
		<Panel className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
			<p className="text-sm text-bjork-text-muted">
				Sign in to join this conversation.
			</p>
			<div className="flex gap-2">
				<Button asChild>
					<Link to="/auth/register">Sign up</Link>
				</Button>
				<Button variant="outline" asChild>
					<Link to="/auth/login">Sign in</Link>
				</Button>
			</div>
		</Panel>
	);
}
