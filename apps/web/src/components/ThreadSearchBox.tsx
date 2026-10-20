import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The issue/pull-request list search box. The committed query lives in the URL
 * (`?q=`), so the input keeps a local draft and only submits on Enter/click;
 * it resyncs when the URL changes via back/forward or a tab click.
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
			className="flex w-full max-w-xl gap-2"
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
				className="flex-1"
			/>
			<Button type="submit" size="sm" variant="outline" className="h-9">
				Search
			</Button>
		</form>
	);
}
