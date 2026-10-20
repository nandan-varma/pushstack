import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tag } from "lucide-react";
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
 * An issue's or pull request's labels, with a picker for people who can
 * triage (write access). Everyone else just sees the chips.
 */
export function ThreadLabels({
	owner,
	name,
	repoId,
	number,
	labels,
	canEdit,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	labels: LabelView[];
	canEdit: boolean;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: allLabels } = useQuery({
		...repositoryLabelsQueryOptions(repoId),
		enabled: canEdit,
	});
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

	if (!canEdit && labels.length === 0) return null;
	const selected = new Set(labels.map((label) => label.name));
	const toggle = (label: string) => {
		const next = new Set(selected);
		if (!next.delete(label)) next.add(label);
		mutation.mutate({ data: { repoId, number, labels: [...next] } });
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			{labels.map((label) => (
				<LabelChip key={label.id} {...label} />
			))}
			{canEdit && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="sm" variant="outline" disabled={mutation.isPending}>
							<Tag className="size-3.5" />
							Labels
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-64">
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
			)}
		</div>
	);
}
