import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { repositoryMilestonesQueryOptions } from "@/lib/query-options";
import { setThreadMilestone } from "@/server/milestones";

const NONE = "none";

/**
 * The milestone picker for people who can triage. Lazy-loaded by
 * `ThreadMilestone`, like the label picker: the dropdown menu is only
 * downloaded by viewers with write access.
 */
export default function ThreadMilestonePicker({
	owner,
	name,
	repoId,
	number,
	current,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	current: number | null;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data } = useQuery(repositoryMilestonesQueryOptions(repoId, "open"));
	const mutation = useMutation({
		mutationFn: setThreadMilestone,
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
			queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
		},
		onError: (err: Error) =>
			toast(err.message || "Failed to set milestone", "error"),
	});
	const milestones = data?.milestones ?? [];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					size="icon-xs"
					variant="ghost"
					disabled={mutation.isPending}
					aria-label="Edit milestone"
				>
					<Settings2 />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>Set milestone</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={current === null ? NONE : String(current)}
					onValueChange={(value) =>
						mutation.mutate({
							data: {
								repoId,
								number,
								milestone: value === NONE ? null : Number(value),
							},
						})
					}
				>
					<DropdownMenuRadioItem value={NONE}>
						No milestone
					</DropdownMenuRadioItem>
					{milestones.map((milestone) => (
						<DropdownMenuRadioItem
							key={milestone.id}
							value={String(milestone.number)}
						>
							<span className="truncate">{milestone.title}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{data && milestones.length === 0 && (
					<p className="px-2 py-1.5 text-sm text-muted-foreground">
						No open milestones.{" "}
						<Link
							to="/$owner/$name/milestones/new"
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
