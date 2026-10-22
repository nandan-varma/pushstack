import type { ReactNode } from "react";
import {
	segmentedItemClassName,
	segmentedRailClassName,
} from "@/components/segmented-navigation";
import { cn } from "@/lib/utils";

/**
 * Mutually exclusive filters. `rail` is the standalone segmented control;
 * `inline` sits in a panel header as quiet text tabs.
 */
export function FilterTabs<T extends string>({
	tabs,
	activeTab,
	onTabChange,
	variant = "rail",
	label,
}: {
	tabs: { value: T; label: string; count?: number; icon?: ReactNode }[];
	activeTab: T;
	onTabChange: (value: T) => void;
	variant?: "rail" | "inline";
	/** Accessible name of the group. */
	label?: string;
}) {
	return (
		<fieldset
			aria-label={label}
			className={
				variant === "rail"
					? segmentedRailClassName
					: "-mx-2 flex min-w-0 items-center gap-1 overflow-x-auto"
			}
		>
			{tabs.map(({ value, label, count, icon }) => (
				<button
					key={value}
					type="button"
					aria-pressed={activeTab === value}
					aria-label={count !== undefined ? `${label} (${count})` : label}
					className={
						variant === "rail"
							? segmentedItemClassName
							: cn(
									"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-sm text-bjork-text-soft transition-[background-color,color] duration-150 hover:text-bjork-text [&_svg]:size-4",
									"aria-pressed:bg-bjork-surface-active aria-pressed:font-medium aria-pressed:text-bjork-text",
								)
					}
					onClick={() => onTabChange(value)}
				>
					{icon}
					{label}
					{count !== undefined && (
						<span className="rounded-full bg-bjork-field-inset px-1.5 py-px font-mono text-[11px] text-bjork-text-medium tabular-nums">
							{count}
						</span>
					)}
				</button>
			))}
		</fieldset>
	);
}
