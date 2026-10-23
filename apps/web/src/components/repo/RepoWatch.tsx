import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { setWatchLevel } from "@/server/watching";

type WatchLevel = "participating" | "all" | "ignore";

const LEVELS: { level: WatchLevel; label: string; hint: string }[] = [
	{
		level: "participating",
		label: "Participating and @mentions",
		hint: "Only when you take part or are mentioned",
	},
	{
		level: "all",
		label: "All activity",
		hint: "Every new issue and pull request",
	},
	{ level: "ignore", label: "Ignore", hint: "Only when you are mentioned" },
];

/**
 * Watch / Unwatch for a repository, GitHub's three levels in a menu, with the
 * number of people watching. Optimistic on the cached repository row.
 */
export function RepoWatch({
	owner,
	name,
	repo,
}: {
	owner: string;
	name: string;
	repo: { id: number; watchLevel: WatchLevel; watcherCount: number };
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const repoQueryKey = queryKeys.repositoryByName(owner, name);

	const mutation = useMutation({
		mutationFn: setWatchLevel,
		...useOptimisticUpdate<typeof repo>(
			repoQueryKey,
			(old, vars) => {
				if (!old) return old;
				const next = (vars as { data: { level: WatchLevel } }).data.level;
				const was = old.watchLevel === "all" ? 1 : 0;
				const now = next === "all" ? 1 : 0;
				return {
					...old,
					watchLevel: next,
					watcherCount: Math.max(0, old.watcherCount - was + now),
				};
			},
			"Failed to update watch settings",
		),
		onSettled: () => queryClient.invalidateQueries({ queryKey: repoQueryKey }),
	});

	const watching = repo.watchLevel === "all";
	const Icon = repo.watchLevel === "ignore" ? EyeOff : Eye;

	if (!session) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-9 w-full justify-start gap-2"
				onClick={() => toast("Sign in to watch this repository", "info")}
			>
				<Eye aria-hidden="true" className="size-4" />
				<span>Watch</span>
				<span className="ml-auto tabular-nums text-bjork-text-medium">
					{repo.watcherCount}
				</span>
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-9 w-full justify-start gap-2"
					aria-label={`Watch settings: ${
						LEVELS.find((l) => l.level === repo.watchLevel)?.label
					}`}
					disabled={mutation.isPending}
				>
					<Icon aria-hidden="true" className="size-4" />
					<span>{watching ? "Watching" : "Watch"}</span>
					<span className="ml-auto tabular-nums text-bjork-text-medium">
						{repo.watcherCount}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>Notifications</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={repo.watchLevel}
					onValueChange={(level) => {
						if (level !== repo.watchLevel) {
							mutation.mutate({
								data: { repoId: repo.id, level: level as WatchLevel },
							});
						}
					}}
				>
					{LEVELS.map(({ level, label, hint }) => (
						<DropdownMenuRadioItem key={level} value={level}>
							<span className="flex flex-col">
								<span>{label}</span>
								<span className="text-xs text-bjork-text-soft">{hint}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
