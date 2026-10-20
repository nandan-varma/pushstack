import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { queryKeys, repositoryBranchesQueryOptions } from "@/lib/query-options";
import { deletePullRequestBranch } from "@/server/pull-requests";

export function DeleteMergedBranchCard({
	repoId,
	prId,
	branch,
	defaultBranch,
}: {
	repoId: number;
	prId: number;
	branch: string;
	defaultBranch: string;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: branches } = useQuery(repositoryBranchesQueryOptions(repoId));
	const remove = useMutation({
		mutationFn: deletePullRequestBranch,
		onSuccess: async () => {
			toast(`Deleted branch ${branch}`, "success");
			// The timeline first: refetching branches unmounts this card.
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.timelineRoot(repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoBranches(repoId),
				}),
			]);
		},
		onError: (err: Error) =>
			toast(err.message || "Failed to delete branch", "error"),
	});

	if (branch === defaultBranch || !branches?.some((b) => b.name === branch)) {
		return null;
	}

	return (
		<Card className="flex flex-wrap items-center justify-between gap-3 p-4">
			<p className="flex items-center gap-2 text-sm text-muted-foreground">
				<GitBranch className="size-4" />
				The <code className="font-mono text-foreground">{branch}</code> branch
				can be safely deleted.
			</p>
			<LoadingButton
				size="sm"
				variant="outline"
				isLoading={remove.isPending}
				loadingLabel="Deleting…"
				onClick={() => remove.mutate({ data: { prId } })}
			>
				Delete branch
			</LoadingButton>
		</Card>
	);
}
