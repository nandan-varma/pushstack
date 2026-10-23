import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ReleaseEntry } from "@/components/releases/ReleaseView";
import { useToast } from "@/components/toast-provider";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryReleaseQueryOptions,
} from "@/lib/query-options";
import { deleteReleaseFn } from "@/server/releases";

export const Route = createFileRoute("/$owner/$name/releases/tag/$")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryReleaseQueryOptions(repo.id, params._splat ?? ""),
			);
		}
	},
	component: ReleasePage,
});

function ReleasePage() {
	const { owner, name, _splat } = Route.useParams();
	const tag = _splat ?? "";
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...repositoryReleaseQueryOptions(repo?.id ?? 0, tag),
		enabled: !!repo,
	});
	const remove = useMutation({
		mutationFn: deleteReleaseFn,
		onSuccess: async () => {
			if (repo) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.repoReleasesRoot(repo.id),
				});
			}
			await navigate({ to: "/$owner/$name/releases", params: { owner, name } });
		},
		onError: (err: Error) => toast(err.message, "error"),
	});
	return (
		<div className="space-y-6">
			<BackLink
				to="/$owner/$name/releases"
				params={{ owner, name }}
				label="All releases"
			/>
			<PageHeader
				title={data?.release.draft ? "Draft release" : "Release"}
				actions={
					data?.canWrite && repo ? (
						<>
							<Link
								to="/$owner/$name/releases/edit/$"
								params={{ owner, name, _splat: tag }}
							>
								<Button variant="outline">Edit</Button>
							</Link>
							<LoadingButton
								variant="destructive"
								isLoading={remove.isPending}
								loadingLabel="Deleting…"
								onClick={() => {
									if (
										window.confirm(
											"Delete this release and its files? The tag is kept.",
										)
									) {
										remove.mutate({
											data: { repoId: repo.id, releaseId: data.release.id },
										});
									}
								}}
							>
								Delete
							</LoadingButton>
						</>
					) : undefined
				}
			/>
			{!repo || !data ? (
				<Skeleton className="h-40" />
			) : (
				<ReleaseEntry
					owner={owner}
					name={name}
					repoId={repo.id}
					release={data.release}
					isLatest={data.isLatest}
					heading="plain"
				/>
			)}
		</div>
	);
}
