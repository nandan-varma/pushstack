import { FilterTabs } from "@/components/FilterTabs";
import { LabelFilter } from "@/components/LabelFilter";
import {
	parseSearchQuery,
	type SearchStatus,
	withSearchLabel,
	withSearchStatus,
} from "@/lib/search-query";

export type ThreadStatusTab = { value: SearchStatus; label: string };

export const ISSUE_STATUS_TABS: ThreadStatusTab[] = [
	{ value: "open", label: "Open" },
	{ value: "closed", label: "Closed" },
	{ value: "all", label: "All" },
];

export const PULL_REQUEST_STATUS_TABS: ThreadStatusTab[] = [
	{ value: "open", label: "Open" },
	{ value: "merged", label: "Merged" },
	{ value: "closed", label: "Closed" },
	{ value: "all", label: "All" },
];

export function activeThreadTab(
	q: string,
	tabs: ThreadStatusTab[],
): SearchStatus {
	const { status } = parseSearchQuery(q);
	return tabs.find((tab) => tab.value === status)?.value ?? "open";
}

/**
 * Status tabs plus the label filter. Only the loaded page (the active tab's
 * rows) is counted, so only the active tab shows a count.
 */
export function ThreadFilters({
	q,
	repoId,
	tabs,
	loadedCount,
	onQueryChange,
}: {
	q: string;
	repoId: number | undefined;
	tabs: ThreadStatusTab[];
	loadedCount: number;
	onQueryChange: (next: string) => void;
}) {
	const activeTab = activeThreadTab(q, tabs);
	return (
		<>
			<FilterTabs
				tabs={tabs.map(({ value, label }) => ({
					value,
					label,
					count: value === activeTab ? loadedCount : undefined,
				}))}
				activeTab={activeTab}
				onTabChange={(value) => onQueryChange(withSearchStatus(q, value))}
			/>
			<LabelFilter
				repoId={repoId}
				value={parseSearchQuery(q).labels[0]}
				onChange={(value) => onQueryChange(withSearchLabel(q, value))}
			/>
		</>
	);
}
