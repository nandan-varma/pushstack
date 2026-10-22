import type { CSSProperties } from "react";

/**
 * A label tinted by its own colour rather than filled with it: a soft wash,
 * an edge, and text pulled toward the theme's text colour so any label
 * colour stays readable on either theme.
 */
export function LabelChip({
	name,
	color,
	description,
}: {
	name: string;
	color: string;
	description?: string | null;
}) {
	return (
		<span
			title={description ?? undefined}
			style={{ "--label": `#${color}` } as CSSProperties}
			className="inline-flex h-5 shrink-0 items-center rounded-full border border-[color-mix(in_oklab,var(--label)_48%,transparent)] bg-[color-mix(in_oklab,var(--label)_16%,transparent)] px-2 text-[11px] leading-none font-medium text-[color-mix(in_oklab,var(--label)_55%,var(--bjork-text))]"
		>
			{name}
		</span>
	);
}
