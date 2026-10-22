import { useQuery } from "@tanstack/react-query";
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
				className="h-10 w-full shrink-0 sm:w-52"
				aria-label="Filter by label"
			>
				<SelectValue placeholder="All labels" />
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
