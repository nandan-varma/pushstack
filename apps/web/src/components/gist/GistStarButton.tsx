import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StarButton } from "@/components/repo/StarButton";
import { useToast } from "@/components/toast-provider";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { type getGistPage, toggleGistStar } from "@/server/gists";

type GistPageData = Awaited<ReturnType<typeof getGistPage>>;

/** The star toggle for a gist, wired to its cached page optimistically. */
export function GistStarButton({
	owner,
	id,
	revision,
	isStarred,
	starCount,
}: {
	owner: string;
	id: string;
	revision: string;
	isStarred: boolean;
	starCount: number;
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const pageKey = queryKeys.gistPage(owner, id, revision);

	const starMutation = useMutation({
		mutationFn: toggleGistStar,
		...useOptimisticUpdate<GistPageData>(
			pageKey,
			(data) =>
				data && {
					...data,
					isStarred: !data.isStarred,
					starCount: data.isStarred ? data.starCount - 1 : data.starCount + 1,
				},
			"Failed to update star",
		),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.gistsRoot });
		},
	});

	return (
		<StarButton
			starCount={starCount}
			isStarred={isStarred}
			isPending={starMutation.isPending}
			signedIn={Boolean(session)}
			onToggle={() =>
				session
					? starMutation.mutate({ data: { owner, id } })
					: toast("Sign in to star this gist", "info")
			}
		/>
	);
}
