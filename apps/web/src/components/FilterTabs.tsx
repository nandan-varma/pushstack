import {
	segmentedItemClassName,
	segmentedRailClassName,
} from "@/components/segmented-navigation";

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
		<div className={segmentedRailClassName}>
			{tabs.map(({ value, label, count }) => (
				<button
					key={value}
					type="button"
					aria-pressed={activeTab === value}
					aria-label={count !== undefined ? `${label} (${count})` : label}
					className={segmentedItemClassName}
					onClick={() => onTabChange(value)}
				>
					{label}
					{count !== undefined && (
						<span className="rounded-md bg-background/50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
							{count}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
