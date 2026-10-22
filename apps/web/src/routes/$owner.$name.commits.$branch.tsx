import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Toolbar } from "@/components/layout/page";
import { CommitList } from "@/components/repo/CommitList";
import { RefSelect } from "@/components/repo/RefSelect";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contentQuery } from "@/lib/prefetch";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";

const PAGE_SIZE = 25;

export const Route = createFileRoute("/$owner/$name/commits/$branch")({
	validateSearch: (search: Record<string, unknown>): { page?: number } => ({
		page: (search.page as number) || undefined,
	}),
	loaderDeps: ({ search }) => ({ page: search.page }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);

		// The branch list is cheap (one listing) and answers whether this
		// branch exists: a repository with branches, but not this one, is a
		// 404. An empty repository has none yet — its history is just empty.
		const branches = await queryClient.ensureQueryData(
			repositoryBranchesQueryOptions(repo.id),
		);
		if (
			branches.length > 0 &&
			!branches.some((b) => b.name === params.branch)
		) {
			throw notFound();
		}

		// Fire-and-forget: a cold commit-log walk can take seconds on a repo
		// with no warm result-cache entry yet. CommitsPage's own useQuery
		// (wired to the same key) picks up the in-flight request and renders
		// its own loading state.
		const page = deps.page ?? 1;
		const skip = (page - 1) * PAGE_SIZE;
		await contentQuery(
			queryClient,
			repositoryCommitsQueryOptions({
				repoId: repo.id,
				branchName: params.branch,
				limit: PAGE_SIZE,
				skip,
			}),
		);
	},
	component: CommitsPage,
	notFoundComponent: () => (
		<RepoResourceNotFound
			title="Branch not found"
			message="This branch doesn't exist."
		/>
	),
});

function CommitsPage() {
	const { owner, name, branch } = Route.useParams();
	const { page } = Route.useSearch();
	const navigate = useNavigate();
	const currentPage = page ?? 1;
	const currentSkip = (currentPage - 1) * PAGE_SIZE;

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: commits, isLoading } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			limit: PAGE_SIZE,
			skip: currentSkip,
		}),
		enabled: !!repo,
	});

	const handleBranchChange = useCallback(
		(value: string) => {
			navigate({
				to: "/$owner/$name/commits/$branch",
				params: { owner, name, branch: value },
			});
		},
		[navigate, owner, name],
	);

	const pageLink = (target: number) => ({
		to: "/$owner/$name/commits/$branch" as const,
		params: { owner, name, branch },
		search: { page: target > 1 ? target : undefined },
	});

	return (
		<div className="space-y-5">
			<Toolbar>
				<div className="flex items-center gap-3">
					<h1 className="text-[22px] font-semibold tracking-[-0.025em] text-bjork-text">
						Commits
					</h1>
					{repo && (
						<RefSelect
							repoId={repo.id}
							value={branch}
							onChange={handleBranchChange}
						/>
					)}
				</div>
			</Toolbar>

			{isLoading ? (
				<div className="space-y-2" aria-busy="true">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-14 rounded-[14px]" />
					))}
				</div>
			) : !commits?.length ? (
				<EmptyState message="No commits on this branch yet." />
			) : (
				<>
					<CommitList owner={owner} name={name} commits={commits} groupByDay />

					<nav
						aria-label="Pagination"
						className="flex items-center justify-between gap-3"
					>
						<span className="text-xs text-bjork-text-soft tabular-nums">
							{currentSkip + 1}–{currentSkip + commits.length}
						</span>
						<div className="flex gap-2">
							{currentPage > 1 ? (
								<Link
									{...pageLink(currentPage - 1)}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									<ChevronLeft aria-hidden="true" />
									Newer
								</Link>
							) : null}
							{commits.length === PAGE_SIZE ? (
								<Link
									{...pageLink(currentPage + 1)}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									Older
									<ChevronRight aria-hidden="true" />
								</Link>
							) : null}
						</div>
					</nav>
				</>
			)}
		</div>
	);
}
