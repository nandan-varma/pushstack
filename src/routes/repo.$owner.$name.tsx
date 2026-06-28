import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { CloneModal } from "@/components/CloneModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { toggleStar } from "../server/repositories";

const repoRouteSchema = z.object({
	owner: z.string(),
	name: z.string(),
});

export const Route = createFileRoute("/repo/$owner/$name")({
	validateSearch: (search: Record<string, unknown>): { branch?: string } => ({
		branch: (search.branch as string) || undefined,
	}),
	loader: ({ params, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		),
	component: RepositoryPage,
	parseParams: (params) => repoRouteSchema.parse(params),
});

const tabLinkBase =
	"border-b-2 border-transparent pb-3 text-sm font-medium text-[var(--sea-ink-soft)] transition hover:text-[var(--sea-ink)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]";

function RepositoryPage() {
	const { owner, name } = Route.useParams();
	const { branch: searchBranch } = Route.useSearch();
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();

	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const repoQueryKey = queryKeys.repositoryByName(owner, name);

	const starMutation = useMutation({
		mutationFn: toggleStar,
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: repoQueryKey });
			const prev = queryClient.getQueryData(repoQueryKey);
			queryClient.setQueryData(repoQueryKey, (old: typeof repo) =>
				old
					? {
							...old,
							isStarred: !old.isStarred,
							starCount: old.isStarred ? old.starCount - 1 : old.starCount + 1,
						}
					: old,
			);
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) queryClient.setQueryData(repoQueryKey, ctx.prev);
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: repoQueryKey });
			queryClient.invalidateQueries({ queryKey: queryKeys.repositoriesRoot });
		},
	});

	if (isLoading) {
		return (
			<div className="page-wrap px-4 py-10">
				<Skeleton className="h-48" />
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="page-wrap px-4 py-10 text-center">
				<h1 className="text-xl font-semibold text-[var(--sea-ink)]">
					Repository not found
				</h1>
				<Link to="/dashboard">
					<Button className="mt-4" size="sm">
						Back to Dashboard
					</Button>
				</Link>
			</div>
		);
	}

	const currentBranch = searchBranch || repo?.defaultBranch || "main";
	const isOwner = repo.ownerId === session?.user?.id;

	return (
		<div className="page-wrap px-4 py-8">
			{/* Header */}
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex flex-wrap items-center gap-1.5 text-sm">
						<Link
							to="/repositories"
							className="font-medium text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
						>
							{owner}
						</Link>
						<span className="text-[var(--sea-ink-soft)]">/</span>
						<span className="font-semibold text-[var(--sea-ink)]">{name}</span>
						<span
							className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
								repo.visibility === "public"
									? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
									: "border-[var(--line)] text-[var(--sea-ink-soft)]"
							}`}
						>
							{repo.visibility}
						</span>
					</div>
					{repo.description && (
						<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
							{repo.description}
						</p>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<CloneModal owner={owner} repoName={name} />
					<button
						type="button"
						onClick={() => session && starMutation.mutate({ data: { repoId: repo.id } })}
						className={`flex items-center gap-0 overflow-hidden rounded-md border text-sm font-medium transition-colors ${
							repo.isStarred
								? "border-[var(--lagoon-deep)] bg-[var(--lagoon-deep)] text-white"
								: "border-[var(--line)] bg-transparent text-[var(--sea-ink)] hover:bg-[var(--surface-raised)]"
						} ${!session ? "cursor-not-allowed opacity-50" : ""}`}
					>
						<span className="px-3 py-1.5">{repo.isStarred ? "★" : "☆"}</span>
						<span className="border-l border-current/20 px-2.5 py-1.5 tabular-nums">
							{repo.starCount}
						</span>
					</button>
					{isOwner && (
						<Link to="/repo/$owner/$name/settings" params={{ owner, name }}>
							<Button variant="outline" size="sm">
								Settings
							</Button>
						</Link>
					)}
				</div>
			</div>

			{/* Tab nav */}
			<div className="mb-6 border-b border-[var(--line)]">
				<nav className="flex gap-6">
					<Link
						to="/repo/$owner/$name"
						params={{ owner, name }}
						search={{ branch: currentBranch }}
						className={tabLinkBase}
						activeProps={{ className: "active" }}
					>
						Code
					</Link>
					<Link
						to="/repo/$owner/$name/issues"
						params={{ owner, name }}
						className={tabLinkBase}
						activeProps={{ className: "active" }}
					>
						Issues
					</Link>
					<Link
						to="/repo/$owner/$name/pulls"
						params={{ owner, name }}
						className={tabLinkBase}
						activeProps={{ className: "active" }}
					>
						Pull Requests
					</Link>
					<Link
						to="/repo/$owner/$name/commits"
						params={{ owner, name }}
						search={{ branch: currentBranch }}
						className={tabLinkBase}
						activeProps={{ className: "active" }}
					>
						Commits
					</Link>
				</nav>
			</div>

			<Outlet />
		</div>
	);
}
