import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-options";
import { syncFork } from "@/server/repositories";

const MESSAGE = {
	"fast-forward": "Successfully fetched and fast-forwarded from upstream",
	merge: "Successfully fetched and merged from upstream",
	none: "This branch is not behind the upstream",
} as const;

/**
 * "Sync fork" for a fork's branch: the merge-upstream logic, then every cached
 * read of that branch's content is dropped so the new commits show.
 */
export function SyncFork({
	repoId,
	owner,
	name,
	branch,
}: {
	repoId: number;
	owner: string;
	name: string;
	branch: string;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const mutation = useMutation({
		mutationFn: syncFork,
		onSuccess: ({ mergeType }) => {
			for (const queryKey of [
				queryKeys.repoFilesRoot(repoId),
				queryKeys.repoCommitsRoot(repoId),
				queryKeys.repoBranches(repoId),
				queryKeys.repoPullRequestNumbers(repoId),
				queryKeys.repositoryByName(owner, name),
			]) {
				queryClient.invalidateQueries({ queryKey });
			}
			toast(MESSAGE[mergeType], "success");
		},
		onError: (error: Error) => {
			toast(error.message || "Failed to sync fork", "error");
		},
	});

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="h-9 w-full justify-start gap-2"
			disabled={mutation.isPending}
			onClick={() => mutation.mutate({ data: { repoId, branch } })}
		>
			<RefreshCw
				aria-hidden="true"
				className={`size-4 ${mutation.isPending ? "animate-spin" : ""}`}
			/>
			{mutation.isPending ? "Syncing…" : "Sync fork"}
		</Button>
	);
}
