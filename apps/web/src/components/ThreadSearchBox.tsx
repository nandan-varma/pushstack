import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The issue/pull-request list search box. The committed query lives in the URL
 * (`?q=`), so the input keeps a local draft and only submits on Enter/click;
 * it resyncs when the URL changes via back/forward or a tab click.
 *
 * The field and its submit button are both 40px and share one baseline row.
 */
export function ThreadSearchBox({
	value,
	onSearch,
	placeholder,
	ariaLabel,
}: {
	value: string;
	onSearch: (query: string) => void;
	placeholder: string;
	ariaLabel: string;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);

	return (
		<form
			className="flex w-full max-w-xl items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSearch(draft.trim());
			}}
		>
			<Input
				type="search"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className="h-10 min-w-0 flex-1"
			/>
			<Button type="submit" variant="outline" className="h-10 shrink-0">
				Search
			</Button>
		</form>
	);
}
