import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StarButton } from "@/components/repo/StarButton";
import { useToast } from "@/components/toast-provider";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { toggleStar } from "@/server/repositories";

/** The star toggle for a repository, wired to its cached row optimistically. */
export function RepoStar({
	owner,
	name,
	repo,
}: {
	owner: string;
	name: string;
	repo: { id: number; isStarred: boolean; starCount: number };
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const repoQueryKey = queryKeys.repositoryByName(owner, name);

	const starMutation = useMutation({
		mutationFn: toggleStar,
		...useOptimisticUpdate<typeof repo>(
			repoQueryKey,
			(old) =>
				old
					? {
							...old,
							isStarred: !old.isStarred,
							starCount: old.isStarred ? old.starCount - 1 : old.starCount + 1,
						}
					: old,
			"Failed to update star",
		),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: repoQueryKey });
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
		},
	});

	return (
		<StarButton
			starCount={repo.starCount}
			isStarred={repo.isStarred}
			isPending={starMutation.isPending}
			signedIn={Boolean(session)}
			onToggle={() =>
				session
					? starMutation.mutate({ data: { repoId: repo.id } })
					: toast("Sign in to star this repository", "info")
			}
		/>
	);
}
