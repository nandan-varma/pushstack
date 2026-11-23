import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FolderKanban, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Page } from "@/components/layout/page";
import { NotFoundCard } from "@/components/NotFoundCard";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	MAX_PROJECT_DESCRIPTION_CHARS,
	MAX_PROJECT_TITLE_CHARS,
	MAX_PROJECTS_PER_USER,
} from "@/lib/limits";
import { queryKeys, userProjectsQueryOptions } from "@/lib/query-options";
import { createUserProject } from "@/server/projects";

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

function NewProjectForm({ login }: { login: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [title, setTitle] = useState("");
	const [shortDescription, setShortDescription] = useState("");
	const [isPublic, setIsPublic] = useState(false);
	const [open, setOpen] = useState(false);
	const mutation = useMutation({
		mutationFn: createUserProject,
		onSuccess: ({ number }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.userProjectsRoot(login),
			});
			navigate({
				to: "/users/$login/projects/$number",
				params: { login, number: String(number) },
			});
		},
		onError: (error: Error) =>
			toast(error.message || "Couldn't create the project", "error"),
	});

	if (!open) {
		return (
			<Button onClick={() => setOpen(true)}>
				<Plus aria-hidden="true" />
				New project
			</Button>
		);
	}
	return (
		<form
			aria-label="New project"
			className="space-y-4 rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (!title.trim()) return;
				mutation.mutate({
					data: {
						title,
						shortDescription: shortDescription || null,
						public: isPublic,
					},
				});
			}}
		>
			<div className="space-y-1.5">
				<Label htmlFor="new-project-title">Project title</Label>
				<Input
					id="new-project-title"
					value={title}
					maxLength={MAX_PROJECT_TITLE_CHARS}
					placeholder="My project"
					onChange={(event) => setTitle(event.target.value)}
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="new-project-description">Description</Label>
				<Input
					id="new-project-description"
					value={shortDescription}
					maxLength={MAX_PROJECT_DESCRIPTION_CHARS}
					placeholder="Optional short description"
					onChange={(event) => setShortDescription(event.target.value)}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm text-bjork-text-medium">
				<input
					type="checkbox"
					checked={isPublic}
					onChange={(event) => setIsPublic(event.target.checked)}
					className="size-4 accent-bjork-accent"
				/>
				Public
			</label>
			<div className="flex justify-end gap-2">
				<Button variant="outline" type="button" onClick={() => setOpen(false)}>
					Cancel
				</Button>
				<LoadingButton
					type="submit"
					isLoading={mutation.isPending}
					disabled={!title.trim()}
				>
					Create project
				</LoadingButton>
			</div>
		</form>
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
			{data.viewerIsOwner && <NewProjectForm login={login} />}
			{data.projects.length >= MAX_PROJECTS_PER_USER && (
				<p className="text-xs text-bjork-text-soft">
					This user holds the maximum of {MAX_PROJECTS_PER_USER} projects.
				</p>
			)}
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
