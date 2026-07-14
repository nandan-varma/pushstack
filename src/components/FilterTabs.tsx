const filterTabBase =
	"border-b-2 px-1 pb-3 text-sm font-medium transition cursor-pointer";
const filterTabActive = "border-[var(--lagoon-deep)] text-[var(--lagoon-deep)]";
const filterTabInactive =
	"border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]";

export function FilterTabs<T extends string>({
	tabs,
	activeTab,
	onTabChange,
}: {
	tabs: { value: T; label: string; count?: number }[];
	activeTab: T;
	onTabChange: (value: T) => void;
}) {
	return (
		<div className="flex items-center gap-5 overflow-x-auto border-b border-[var(--line)]">
			{tabs.map(({ value, label, count }) => (
				<button
					key={value}
					type="button"
					className={`${filterTabBase} shrink-0 ${activeTab === value ? filterTabActive : filterTabInactive}`}
					onClick={() => onTabChange(value)}
				>
					{label}
					{count !== undefined ? ` (${count})` : ""}
				</button>
			))}
		</div>
	);
}
