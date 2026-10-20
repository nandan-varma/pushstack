import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { EmptyState } from "@/components/EmptyState";
import { CommitList } from "@/components/repo/CommitList";
import { RefSelect } from "@/components/repo/RefSelect";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
		queryClient
			.ensureQueryData(
				repositoryCommitsQueryOptions({
					repoId: repo.id,
					branchName: params.branch,
					limit: PAGE_SIZE,
					skip,
				}),
			)
			.catch(() => {});
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

	return (
		<div className="space-y-5">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					{repo && (
						<RefSelect
							repoId={repo.id}
							value={branch}
							onChange={handleBranchChange}
						/>
					)}
					{commits && commits.length > 0 && (
						<span className="text-xs text-muted-foreground">
							{commits.length} commit{commits.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<BackLink
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch, _splat: "" }}
					label="Back to files"
				/>
			</div>

			{/* Commits list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !commits?.length ? (
				<EmptyState
					message="No commits found in this branch."
					action={
						<Link
							to="/$owner/$name/tree/$branch/$"
							params={{ owner, name, branch, _splat: "" }}
						>
							<Button variant="outline" size="sm">
								View files
							</Button>
						</Link>
					}
				/>
			) : (
				<>
					<CommitList owner={owner} name={name} commits={commits} />

					{/* Pagination */}
					<div className="flex items-center justify-center gap-3">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1}
							onClick={() =>
								navigate({
									to: "/$owner/$name/commits/$branch",
									params: { owner, name, branch },
									search: { page: Math.max(1, currentPage - 1) },
								})
							}
						>
							Previous
						</Button>
						<span className="text-xs text-muted-foreground">
							{currentSkip + 1}–{currentSkip + commits.length}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={commits.length < PAGE_SIZE}
							onClick={() =>
								navigate({
									to: "/$owner/$name/commits/$branch",
									params: { owner, name, branch },
									search: { page: currentPage + 1 },
								})
							}
						>
							Next
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
