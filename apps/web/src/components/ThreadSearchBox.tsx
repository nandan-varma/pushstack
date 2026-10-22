import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * The issue/pull-request list search box. The committed query lives in the URL
 * (`?q=`), so the input keeps a local draft and only submits on Enter; it
 * resyncs when the URL changes via back/forward or a tab click.
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
			role="search"
			className="relative min-w-0 flex-1 basis-72"
			onSubmit={(event) => {
				event.preventDefault();
				onSearch(draft.trim());
			}}
		>
			<Search
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-bjork-text-soft"
			/>
			<Input
				type="search"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className="h-10 pl-10"
			/>
			<button type="submit" className="sr-only">
				Search
			</button>
		</form>
	);
}
