import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BODY_CHARS, MAX_THREAD_TITLE_CHARS } from "@/lib/limits";

/**
 * The draft-issue form, for both adding a draft to a project and editing an
 * existing draft: GitHub keeps the same title/body fields for both.
 */
export function ProjectDraftDialog({
	open,
	onOpenChange,
	initial,
	submitLabel,
	pending,
	error,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial: { title: string; body: string | null };
	submitLabel: string;
	pending: boolean;
	error?: string | null;
	onSubmit: (draft: { title: string; body: string | null }) => void;
}) {
	const [title, setTitle] = useState(initial.title);
	const [body, setBody] = useState(initial.body ?? "");

	useEffect(() => {
		if (open) {
			setTitle(initial.title);
			setBody(initial.body ?? "");
		}
	}, [open, initial.title, initial.body]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Draft issue</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="project-draft-title">Title</Label>
						<Input
							id="project-draft-title"
							value={title}
							maxLength={MAX_THREAD_TITLE_CHARS}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="Draft title"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="project-draft-body">Body</Label>
						<Textarea
							id="project-draft-body"
							value={body}
							maxLength={MAX_BODY_CHARS}
							rows={8}
							onChange={(event) => setBody(event.target.value)}
							placeholder="What is this draft about?"
						/>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<LoadingButton
							isLoading={pending}
							loadingLabel="Saving…"
							disabled={!title.trim()}
							onClick={() => onSubmit({ title, body: body || null })}
						>
							{submitLabel}
						</LoadingButton>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
