import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TagIcon } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ReleaseEntry } from "@/components/releases/ReleaseView";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryReleasesQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/releases/")({
	validateSearch: z.object({
		page: z.number().int().min(1).max(500).optional().catch(undefined),
	}),
	loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryReleasesQueryOptions(repo.id, deps.page),
			);
		}
	},
	component: ReleasesPage,
});

function ReleasesPage() {
	const { owner, name } = Route.useParams();
	const { page = 1 } = Route.useSearch();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data, isLoading } = useQuery({
		...repositoryReleasesQueryOptions(repo?.id ?? 0, page),
		enabled: !!repo,
	});
	const lastPage = data
		? Math.max(1, Math.ceil(data.total / data.pageSize))
		: 1;
	return (
		<div className="space-y-6">
			<PageHeader
				title="Releases"
				meta={data?.total}
				actions={
					data?.canWrite && (
						<Link to="/$owner/$name/releases/new" params={{ owner, name }}>
							<Button>Draft a new release</Button>
						</Link>
					)
				}
			/>
			{isLoading || !repo || !data ? (
				<Skeleton className="h-40" />
			) : data.releases.length === 0 ? (
				<EmptyState
					icon={<TagIcon />}
					title="No releases yet"
					message="Releases package a tag with notes and downloadable files."
					action={
						data.canWrite && (
							<Link to="/$owner/$name/releases/new" params={{ owner, name }}>
								<Button>Draft a new release</Button>
							</Link>
						)
					}
				/>
			) : (
				<div className="space-y-10">
					{data.releases.map((release) => (
						<ReleaseEntry
							key={release.id}
							owner={owner}
							name={name}
							repoId={repo.id}
							release={release}
							isLatest={release.id === data.latestId}
						/>
					))}
					{lastPage > 1 && (
						<nav
							className="flex items-center justify-between"
							aria-label="Pages"
						>
							{page > 1 ? (
								<Link
									to="/$owner/$name/releases"
									params={{ owner, name }}
									search={{ page: page - 1 }}
								>
									<Button variant="outline">Newer</Button>
								</Link>
							) : (
								<span />
							)}
							{page < lastPage && (
								<Link
									to="/$owner/$name/releases"
									params={{ owner, name }}
									search={{ page: page + 1 }}
								>
									<Button variant="outline">Older</Button>
								</Link>
							)}
						</nav>
					)}
				</div>
			)}
		</div>
	);
}
