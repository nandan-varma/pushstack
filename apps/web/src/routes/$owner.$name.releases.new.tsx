import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ReleaseForm } from "@/components/releases/ReleaseForm";
import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/releases/new")({
	loader: ({ params, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		),
	component: NewReleasePage,
});

function NewReleasePage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	return (
		<div className="space-y-6">
			<BackLink
				to="/$owner/$name/releases"
				params={{ owner, name }}
				label="All releases"
			/>
			<PageHeader title="New release" />
			{repo ? (
				<ReleaseForm
					owner={owner}
					name={name}
					repoId={repo.id}
					defaultBranch={repo.defaultBranch}
				/>
			) : (
				<Skeleton className="h-64" />
			)}
		</div>
	);
}
