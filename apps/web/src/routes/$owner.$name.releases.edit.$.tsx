import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ReleaseForm } from "@/components/releases/ReleaseForm";
import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryReleaseQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/releases/edit/$")({
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
	component: EditReleasePage,
});

function EditReleasePage() {
	const { owner, name, _splat } = Route.useParams();
	const tag = _splat ?? "";
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...repositoryReleaseQueryOptions(repo?.id ?? 0, tag),
		enabled: !!repo,
	});
	return (
		<div className="space-y-6">
			<BackLink
				to="/$owner/$name/releases/tag/$"
				params={{ owner, name, _splat: tag }}
				label="Back to release"
			/>
			<PageHeader title="Edit release" />
			{repo && data?.canWrite ? (
				<ReleaseForm
					key={data.release.id}
					owner={owner}
					name={name}
					repoId={repo.id}
					defaultBranch={data.defaultBranch}
					initial={{
						id: data.release.id,
						tagName: data.release.tagName,
						targetCommitish: data.release.targetCommitish,
						name: data.release.name ?? "",
						body: data.release.body ?? "",
						draft: data.release.draft,
						prerelease: data.release.prerelease,
						isLatest: data.isLatest,
						assets: data.release.assets.map((asset) => ({
							id: asset.id,
							name: asset.name,
							size: asset.size,
						})),
					}}
				/>
			) : data ? (
				<p className="text-sm text-bjork-text-muted">
					You need write access to edit releases.
				</p>
			) : (
				<Skeleton className="h-64" />
			)}
		</div>
	);
}
