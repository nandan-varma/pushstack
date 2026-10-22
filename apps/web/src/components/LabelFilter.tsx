import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { repositoryLabelsQueryOptions } from "@/lib/query-options";

const ALL = "__all__";

export function LabelFilter({
	repoId,
	value,
	onChange,
}: {
	repoId: number | undefined;
	value: string | undefined;
	onChange: (label: string | undefined) => void;
}) {
	const { data } = useQuery({
		...repositoryLabelsQueryOptions(repoId ?? 0),
		enabled: repoId !== undefined,
	});
	const labels = data?.labels ?? [];
	if (labels.length === 0 && !value) return null;
	return (
		<Select
			value={value ?? ALL}
			onValueChange={(next) => onChange(next === ALL ? undefined : next)}
		>
			<SelectTrigger
				className="h-8 w-auto min-w-36 shrink-0 gap-2 rounded-[10px] text-[13px]"
				aria-label="Filter by label"
			>
				<Tag aria-hidden="true" className="size-3.5 text-bjork-text-soft" />
				<SelectValue>
					{(selected: string) => (selected === ALL ? "All labels" : selected)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ALL}>All labels</SelectItem>
				{value && !labels.some((label) => label.name === value) && (
					<SelectItem value={value}>{value}</SelectItem>
				)}
				{labels.map((label) => (
					<SelectItem key={label.id} value={label.name}>
						{label.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
