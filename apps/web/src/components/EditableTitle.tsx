import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";

/**
 * A thread title with GitHub's "Edit" affordance. The edit button is
 * rendered by the caller (`useEditableTitle().editButton`) so it can sit with
 * the header's other actions while the field replaces the title in place.
 */
export function useEditableTitle({
	title,
	onSave,
	isSaving,
}: {
	title: string;
	onSave?: (title: string) => Promise<unknown>;
	isSaving?: boolean;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const save = async () => {
		if (draft === null) return;
		try {
			await onSave?.(draft.trim());
			setDraft(null);
		} catch {
			// The mutation reports the failure; keep the draft.
		}
	};

	const editing = draft !== null;
	const titleNode = editing ? (
		<form
			className="flex flex-wrap items-center gap-2 text-base font-normal tracking-normal"
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<Input
				aria-label="Title"
				className="h-10 min-w-64 flex-1 text-base"
				value={draft}
				maxLength={256}
				// The person just asked to edit, so focus follows them.
				autoFocus
				onChange={(e) => setDraft(e.target.value)}
			/>
			<LoadingButton
				type="submit"
				disabled={!draft.trim()}
				isLoading={isSaving}
				loadingLabel="Saving…"
			>
				Save
			</LoadingButton>
			<Button type="button" variant="ghost" onClick={() => setDraft(null)}>
				Cancel
			</Button>
		</form>
	) : (
		title
	);

	const editButton =
		onSave && !editing ? (
			<Button variant="outline" onClick={() => setDraft(title)}>
				Edit
			</Button>
		) : null;

	return { titleNode, editButton, editing };
}
