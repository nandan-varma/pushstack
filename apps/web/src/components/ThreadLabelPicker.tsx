import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { LabelChip } from "@/components/LabelChip";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LabelView } from "@/lib/labels";
import { repositoryLabelsQueryOptions } from "@/lib/query-options";
import { setLabels } from "@/server/labels";

/**
 * The label picker for people who can triage. Lazy-loaded by `ThreadLabels`:
 * the dropdown menu (Base UI menu + floating-ui, ~40 kB gzipped) is only
 * downloaded by viewers with write access.
 */
export default function ThreadLabelPicker({
	owner,
	name,
	repoId,
	number,
	labels,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	labels: LabelView[];
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: allLabels } = useQuery(repositoryLabelsQueryOptions(repoId));
	const mutation = useMutation({
		mutationFn: setLabels,
		onSettled: () => {
			// The thread is cached by owner/name, its lists and timeline by repo.
			queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
			queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
		},
		onError: (err: Error) =>
			toast(err.message || "Failed to set labels", "error"),
	});

	const selected = new Set(labels.map((label) => label.name));
	const toggle = (label: string) => {
		const next = new Set(selected);
		if (!next.delete(label)) next.add(label);
		mutation.mutate({ data: { repoId, number, labels: [...next] } });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					size="icon-xs"
					variant="ghost"
					disabled={mutation.isPending}
					aria-label="Edit labels"
				>
					<Settings2 />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>Apply labels</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{(allLabels?.labels ?? []).map((label) => (
					<DropdownMenuCheckboxItem
						key={label.id}
						checked={selected.has(label.name)}
						onSelect={(event) => {
							event.preventDefault();
							toggle(label.name);
						}}
					>
						<LabelChip {...label} />
					</DropdownMenuCheckboxItem>
				))}
				{allLabels?.labels.length === 0 && (
					<p className="px-2 py-1.5 text-sm text-muted-foreground">
						No labels yet.{" "}
						<Link
							to="/$owner/$name/labels"
							params={{ owner, name }}
							className="text-primary hover:underline"
						>
							Create one
						</Link>
					</p>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
