import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Page } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { userProjectsQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/users/$login/projects/")({
	validateSearch: (search: Record<string, unknown>): { page?: number } => ({
		page:
			typeof search.page === "number" && search.page > 1
				? Math.floor(search.page)
				: undefined,
	}),
	loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
	loader: ({ params, deps, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			userProjectsQueryOptions(deps.page, params.login),
		),
	component: ProjectsPage,
	notFoundComponent: UserNotFound,
});

function UserNotFound() {
	const { login } = Route.useParams();
	return (
		<Page>
			<NotFoundCard
				title="User not found"
				message={`No user named "${login}" exists.`}
				backTo="/"
				backLabel="Back to home"
			/>
		</Page>
	);
}

function ProjectsPage() {
	const { login } = Route.useParams();
	const { page = 1 } = Route.useSearch();
	const { data, isLoading } = useQuery(userProjectsQueryOptions(page, login));

	if (isLoading || !data) {
		return (
			<Page className="space-y-4">
				<Skeleton className="h-9 w-56" />
				<Skeleton className="h-40" />
			</Page>
		);
	}

	return (
		<Page className="space-y-5">
			<PageHeader
				title="Projects"
				meta={data.total > 0 ? data.total : undefined}
				description={
					<>
						Projects owned by{" "}
						<Link
							to="/$owner"
							params={{ owner: data.login }}
							className="text-bjork-accent hover:underline"
						>
							{data.login}
						</Link>
					</>
				}
			/>
			{data.projects.length === 0 ? (
				<EmptyState
					icon={<FolderKanban aria-hidden="true" />}
					title="No projects"
					message={`${data.login} has no projects you can see.`}
				/>
			) : (
				<ul className="divide-y divide-bjork-border-muted overflow-hidden rounded-[18px] border border-bjork-border-muted bg-bjork-surface">
					{data.projects.map((project) => (
						<li key={project.number} className="px-5 py-4">
							<Link
								to="/users/$login/projects/$number"
								params={{ login: data.login, number: String(project.number) }}
								className="text-sm font-semibold text-bjork-text hover:text-bjork-accent"
							>
								{project.title}
							</Link>
							<p className="mt-1 text-xs text-bjork-text-soft">
								{project.public ? "Public" : "Private"}
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
					aria-label="Project pages"
					className="flex items-center justify-between text-sm"
				>
					{data.page > 1 ? (
						<Link
							to="/users/$login/projects"
							params={{ login: data.login }}
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
							to="/users/$login/projects"
							params={{ login: data.login }}
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
		</Page>
	);
}
