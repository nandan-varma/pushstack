import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import {
	MAX_MILESTONE_DESCRIPTION_CHARS,
	MAX_MILESTONE_TITLE_CHARS,
} from "@/lib/limits";
import { dueOnFromInput, dueOnInputValue } from "@/lib/milestone";

export interface MilestoneDraft {
	title: string;
	description: string;
	dueOn: Date | null;
}

/** The new and edit milestone form: title, optional due date and description. */
export function MilestoneForm({
	initial,
	submitLabel,
	pending,
	onSubmit,
	onCancel,
}: {
	initial?: { title: string; description: string | null; dueOn: Date | null };
	submitLabel: string;
	pending: boolean;
	onSubmit: (draft: MilestoneDraft) => void;
	onCancel: () => void;
}) {
	const [title, setTitle] = useState(initial?.title ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [dueOn, setDueOn] = useState(dueOnInputValue(initial?.dueOn ?? null));
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit({ title, description, dueOn: dueOnFromInput(dueOn) });
			}}
		>
			<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
				<div className="space-y-1.5">
					<Label htmlFor="milestone-title">Title</Label>
					<Input
						id="milestone-title"
						value={title}
						maxLength={MAX_MILESTONE_TITLE_CHARS}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="v1.0"
						className="h-10"
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="milestone-due">Due date (optional)</Label>
					<Input
						id="milestone-due"
						type="date"
						value={dueOn}
						onChange={(e) => setDueOn(e.target.value)}
						className="h-10"
					/>
				</div>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="milestone-description">Description (optional)</Label>
				<Textarea
					id="milestone-description"
					value={description}
					maxLength={MAX_MILESTONE_DESCRIPTION_CHARS}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="What does this milestone cover?"
				/>
			</div>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<LoadingButton
					type="submit"
					isLoading={pending}
					loadingLabel="Saving…"
					disabled={!title.trim()}
				>
					{submitLabel}
				</LoadingButton>
			</div>
		</form>
	);
}
