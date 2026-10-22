import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { PushGuide } from "@/components/repo/PushGuide";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/setup")({
	loader: ({ params, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		),
	component: SetupPage,
});

function SetupPage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	return (
		<div className="max-w-[760px] space-y-4">
			<PageHeader
				title="Push to this repository"
				description="Everything you need to get code from your machine into it."
			/>
			{repo ? (
				<PushGuide
					owner={owner}
					name={name}
					branch={repo.defaultBranch}
					canWrite={repo.viewer.canWrite}
				/>
			) : (
				<Skeleton className="h-96 rounded-[18px]" />
			)}
		</div>
	);
}
