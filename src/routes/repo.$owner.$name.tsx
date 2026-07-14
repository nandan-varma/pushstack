import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { z } from "zod";
import { NotFoundCard } from "@/components/NotFoundCard";
import { BranchUpdateBanner } from "@/components/repo/BranchUpdateBanner";
import { RepoHeader, RepoHeaderSkeleton } from "@/components/repo/RepoHeader";
import { RepoTabNav, RepoTabNavSkeleton } from "@/components/repo/RepoTabNav";
import { Button } from "@/components/ui/button";
import { useBranchUpdateBanner } from "@/hooks/use-branch-update-banner";
import { perfTime } from "@/lib/perf-log";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

const repoRouteSchema = z.object({
	owner: z.string(),
	name: z.string(),
});

export const Route = createFileRoute("/repo/$owner/$name")({
	loader: ({ params, context: { queryClient } }) =>
		perfTime(`loader repo-layout ${params.owner}/${params.name}`, () =>
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
		),
	component: RepositoryPage,
	errorComponent: RepositoryErrorComponent,
	parseParams: (params) => repoRouteSchema.parse(params),
});

function RepositoryErrorComponent({ error, reset }: ErrorComponentProps) {
	const { owner, name } = Route.useParams();
	return (
		<div className="page-wrap px-4 py-16 text-center">
			<div className="island-shell mx-auto max-w-md rounded-xl p-8">
				<h1 className="mb-2 text-lg font-semibold text-[var(--sea-ink)]">
					Couldn't load {owner}/{name}
				</h1>
				<p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
					{error.message || "An unexpected error occurred."}
				</p>
				<div className="flex items-center justify-center gap-2">
					<Button size="sm" onClick={reset}>
						Try again
					</Button>
					<Link to="/dashboard">
						<Button size="sm" variant="outline">
							Back to Dashboard
						</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}

function RepositoryPage() {
	const { owner, name } = Route.useParams();
	const { pathname } = useLocation();

	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const treeBranchMatch = pathname.match(/\/tree\/([^/]+)/);
	const commitsBranchMatch = pathname.match(/\/commits\/([^/]+)/);
	const isCodeActive =
		pathname.includes("/tree/") || pathname.includes("/blob/");
	const isCommitsActive = /\/commits\/[^/]+/.test(pathname);

	if (isLoading) {
		return (
			<div className="page-wrap px-4 py-8">
				<RepoHeaderSkeleton />
				<RepoTabNavSkeleton />
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="page-wrap px-4 py-16">
				<div className="mx-auto max-w-md">
					<NotFoundCard
						title="Repository not found"
						backTo="/dashboard"
						backLabel="Back to Dashboard"
					/>
				</div>
			</div>
		);
	}

	const currentBranch =
		treeBranchMatch?.[1] ||
		commitsBranchMatch?.[1] ||
		repo?.defaultBranch ||
		"main";

	// Only the code/commits views render branch-scoped (and often long-cached)
	// git data — issues/pulls/settings aren't affected by a push landing on
	// whatever branch happens to be "current", so don't watch or notify there.
	const watchingBranch = isCodeActive || isCommitsActive;

	return (
		<div className="page-wrap px-4 py-8">
			<RepoHeader owner={owner} name={name} repo={repo} />
			<RepoTabNav
				owner={owner}
				name={name}
				currentBranch={currentBranch}
				isCodeActive={isCodeActive}
				isCommitsActive={isCommitsActive}
			/>
			{watchingBranch && (
				<BranchWatcher repoId={repo.id} branchName={currentBranch} />
			)}
			<Outlet />
		</div>
	);
}

function BranchWatcher({
	repoId,
	branchName,
}: {
	repoId: number;
	branchName: string;
}) {
	const { hasUpdate, reload } = useBranchUpdateBanner(repoId, branchName);
	if (!hasUpdate) return null;
	return <BranchUpdateBanner branchName={branchName} onReload={reload} />;
}
