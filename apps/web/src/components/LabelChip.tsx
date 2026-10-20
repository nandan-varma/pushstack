import { labelTextColor } from "@/lib/label-color";

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
			className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium leading-4"
			style={{ backgroundColor: `#${color}`, color: labelTextColor(color) }}
		>
			{name}
		</span>
	);
}
