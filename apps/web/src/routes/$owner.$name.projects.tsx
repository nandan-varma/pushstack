import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repoProjectsQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/projects")({
	validateSearch: (search: Record<string, unknown>): { page?: number } => ({
		page:
			typeof search.page === "number" && search.page > 1
				? Math.floor(search.page)
				: undefined,
	}),
	loader: ({ params, context: { queryClient } }) => {
		return queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
	},
	component: RepoProjectsPage,
});

/**
 * The repository's Projects tab: the user-owned projects that hold one of its
 * issues or pull requests, public ones only, linked to their owner's project.
 */
function RepoProjectsPage() {
	const { owner, name } = Route.useParams();
	const { page = 1 } = Route.useSearch();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data, isLoading } = useQuery(
		repoProjectsQueryOptions(repo?.id ?? 0, page, owner, name),
	);

	if (isLoading || !data || !repo) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-9 w-56" />
				<Skeleton className="h-40" />
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<PageHeader
				title="Projects"
				meta={data.total > 0 ? data.total : undefined}
				description={`Projects holding an issue or pull request from ${owner}/${name}.`}
			/>
			{data.projects.length === 0 ? (
				<EmptyState
					icon={<FolderKanban aria-hidden="true" />}
					title="No linked projects"
					message={`No project you can see holds an issue or pull request from ${owner}/${name}.`}
				/>
			) : (
				<ul className="divide-y divide-bjork-border-muted overflow-hidden rounded-[18px] border border-bjork-border-muted bg-bjork-surface">
					{data.projects.map((project) => (
						<li
							key={`${project.ownerLogin}/${project.number}`}
							className="px-5 py-4"
						>
							<Link
								to="/users/$login/projects/$number"
								params={{
									login: project.ownerLogin,
									number: String(project.number),
								}}
								className="text-sm font-semibold text-bjork-text hover:text-bjork-accent"
							>
								{project.title}
							</Link>
							<p className="mt-1 text-xs text-bjork-text-soft">
								{project.ownerLogin} · {project.public ? "Public" : "Private"}
								{project.closed && " · Closed"} · #{project.number}
							</p>
							{project.shortDescription && (
								<p className="mt-1 line-clamp-2 text-sm text-bjork-text-medium">
									{project.shortDescription}
								</p>
							)}
						</li>
					))}
				</ul>
			)}
			{data.pageCount > 1 && (
				<nav
					aria-label="Repository project pages"
					className="flex items-center justify-between text-sm"
				>
					{data.page > 1 ? (
						<Link
							to="/$owner/$name/projects"
							params={{ owner, name }}
							search={{ page: data.page > 2 ? data.page - 1 : undefined }}
							className="text-bjork-accent hover:underline"
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-bjork-text-soft">
						Page {data.page} of {data.pageCount}
					</span>
					{data.page < data.pageCount ? (
						<Link
							to="/$owner/$name/projects"
							params={{ owner, name }}
							search={{ page: data.page + 1 }}
							className="text-bjork-accent hover:underline"
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</div>
	);
}
