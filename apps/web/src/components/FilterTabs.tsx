const filterTabBase =
	"border-b-2 px-1 pb-3 text-sm font-medium transition cursor-pointer";
const filterTabActive = "border-primary text-primary";
const filterTabInactive =
	"border-transparent text-muted-foreground hover:text-foreground";

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
		<div className="flex items-center gap-5 overflow-x-auto border-b border-border">
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
