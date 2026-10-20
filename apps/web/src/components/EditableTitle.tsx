import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";

export function EditableTitle({
	title,
	onSave,
	isSaving,
}: {
	title: string;
	onSave?: (title: string) => Promise<unknown>;
	isSaving?: boolean;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	if (draft === null) {
		return (
			<>
				{title}
				{onSave && (
					<Button
						variant="ghost"
						size="sm"
						className="ml-2 h-7 align-middle text-xs font-normal text-muted-foreground"
						onClick={() => setDraft(title)}
					>
						<Pencil className="size-3.5" /> Edit
					</Button>
				)}
			</>
		);
	}
	const save = async () => {
		try {
			await onSave?.(draft.trim());
			setDraft(null);
		} catch {
			// The mutation reports the failure; keep the draft.
		}
	};
	return (
		<span className="flex flex-wrap items-center gap-2 text-base font-normal">
			<Input
				aria-label="Title"
				className="min-w-64 flex-1"
				value={draft}
				maxLength={256}
				onChange={(e) => setDraft(e.target.value)}
			/>
			<LoadingButton
				size="sm"
				onClick={save}
				disabled={!draft.trim()}
				isLoading={isSaving}
				loadingLabel="Saving…"
			>
				Save
			</LoadingButton>
			<Button variant="outline" size="sm" onClick={() => setDraft(null)}>
				Cancel
			</Button>
		</span>
	);
}
