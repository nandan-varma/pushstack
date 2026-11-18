import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { Page } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { ProjectTable } from "@/components/project/ProjectTable";
import { ThreadSearchBox } from "@/components/ThreadSearchBox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	MAX_PROJECT_BOARD_ITEMS,
	MAX_PROJECT_FILTER_CHARS,
} from "@/lib/limits";
import { userProjectQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/users/$login/projects/$number")({
	validateSearch: (
		search: Record<string, unknown>,
	): { q?: string; page?: number } => ({
		q:
			typeof search.q === "string" && search.q
				? search.q.slice(0, MAX_PROJECT_FILTER_CHARS)
				: undefined,
		page:
			typeof search.page === "number" && search.page > 1
				? Math.floor(search.page)
				: undefined,
	}),
	loaderDeps: ({ search }) => ({ q: search.q ?? "", page: search.page ?? 1 }),
	loader: ({ params, deps, context: { queryClient } }) => {
		const number = Number(params.number);
		if (!Number.isInteger(number) || number < 1) throw notFound();
		return queryClient.ensureQueryData(
			userProjectQueryOptions(params.login, number, deps.q, deps.page),
		);
	},
	component: ProjectPage,
	notFoundComponent: ProjectNotFound,
});

function ProjectNotFound() {
	const { login } = Route.useParams();
	return (
		<Page>
			<NotFoundCard
				title="Project not found"
				message="This project does not exist or you do not have access to it."
				backTo="/users/$login/projects"
				backParams={{ login }}
				backLabel="Back to projects"
			/>
		</Page>
	);
}

function ProjectPage() {
	const { login, number } = Route.useParams();
	const { q, page } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { data, isLoading } = useQuery(
		userProjectQueryOptions(login, Number(number), q ?? "", page ?? 1),
	);

	if (isLoading || !data) {
		return (
			<Page className="space-y-4">
				<Skeleton className="h-9 w-64" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-64" />
			</Page>
		);
	}

	const { project } = data;
	const setFilter = (next: string) =>
		navigate({ search: { q: next || undefined }, replace: true });
	const pageLink = (target: number) => ({
		to: "/users/$login/projects/$number" as const,
		params: { login, number },
		search: { q: q || undefined, page: target > 1 ? target : undefined },
	});

	return (
		<Page className="space-y-5">
			<PageHeader
				title={project.title}
				meta={`#${project.number}`}
				description={
					<>
						<Link
							to="/$owner"
							params={{ owner: project.ownerLogin }}
							className="text-bjork-accent hover:underline"
						>
							{project.ownerLogin}
						</Link>{" "}
						· {project.public ? "Public" : "Private"}
						{project.closed && " · Closed"} ·{" "}
						{data.itemCount === 1 ? "1 item" : `${data.itemCount} items`}
					</>
				}
				actions={
					<>
						<Badge variant="outline">
							{project.closed ? "Closed" : "Open"}
						</Badge>
						<Badge variant={project.public ? "outline" : "secondary"}>
							{project.public ? "Public" : "Private"}
						</Badge>
					</>
				}
			/>
			{project.shortDescription && (
				<p className="text-sm text-bjork-text-medium">
					{project.shortDescription}
				</p>
			)}
			<ThreadSearchBox
				value={q ?? ""}
				onSearch={setFilter}
				placeholder="Filter by title, is:issue, is:pr, is:draft or status:Todo"
				ariaLabel="Filter project items"
			/>
			{data.truncated && (
				<p className="text-xs text-bjork-text-soft">
					Showing the first {MAX_PROJECT_BOARD_ITEMS} of {data.itemCount} items;
					filter to narrow the list.
				</p>
			)}
			<ProjectTable
				fields={data.fields}
				rows={data.items}
				emptyMessage={
					q
						? "No items match this filter."
						: "This project has no items you can see."
				}
			/>
			{data.pageCount > 1 && (
				<nav
					aria-label="Project item pages"
					className="flex items-center justify-between text-sm"
				>
					{data.page > 1 ? (
						<Link
							{...pageLink(data.page - 1)}
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
							{...pageLink(data.page + 1)}
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
