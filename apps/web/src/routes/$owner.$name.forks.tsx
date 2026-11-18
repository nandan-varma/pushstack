import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GitFork } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { RepositoryRow } from "@/components/repo/RepositoryList";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { backgroundQuery } from "@/lib/prefetch";
import {
	repoForksQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

/** GitHub's `/{owner}/{repo}/forks`: the forks of a repository the viewer can read. */
export const Route = createFileRoute("/$owner/$name/forks")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) backgroundQuery(queryClient, repoForksQueryOptions(repo.id));
	},
	component: ForksPage,
});

function ForksPage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data: forks, isLoading } = useQuery({
		...repoForksQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	return (
		<div className="space-y-6">
			<PageHeader
				title="Forks"
				meta={repo?.forksCount}
				description="Repositories copied from this one, each free to diverge."
			/>
			{isLoading || !repo || !forks ? (
				<Skeleton className="h-40" />
			) : forks.length === 0 ? (
				<EmptyState
					icon={<GitFork />}
					title="No forks yet"
					message="A fork is a copy of this repository in another account, ready for changes of its own."
					action={
						<Link to="/$owner/$name" params={{ owner, name }}>
							<Button variant="outline">Back to repository</Button>
						</Link>
					}
				/>
			) : (
				<Panel>
					<PanelHeader
						title={`${forks.length} ${forks.length === 1 ? "fork" : "forks"} of ${owner}/${name}`}
					/>
					<ul className="divide-y divide-bjork-border-muted">
						{forks.map((fork) => (
							<RepositoryRow key={fork.id} repo={fork} />
						))}
					</ul>
				</Panel>
			)}
		</div>
	);
}
