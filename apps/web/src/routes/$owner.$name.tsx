import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	Outlet,
	useMatchRoute,
	useParams,
} from "@tanstack/react-router";
import { NotFoundCard } from "@/components/NotFoundCard";
import { BranchUpdateBanner } from "@/components/repo/BranchUpdateBanner";
import { GuestSignupBanner } from "@/components/repo/GuestSignupBanner";
import { RepoHeader, RepoHeaderSkeleton } from "@/components/repo/RepoHeader";
import { RepoTabNav, RepoTabNavSkeleton } from "@/components/repo/RepoTabNav";
import { Button } from "@/components/ui/button";
import { useBranchUpdateBanner } from "@/hooks/use-branch-update-banner";
import { perfTime } from "@/lib/perf-log";
import { repositoryByNameQueryOptions } from "@/lib/query-options";
import { SITE_URL } from "@/lib/site";

export const Route = createFileRoute("/$owner/$name")({
	loader: ({ params, context: { queryClient } }) =>
		perfTime(`loader repo-layout ${params.owner}/${params.name}`, () =>
			queryClient.ensureQueryData(
				repositoryByNameQueryOptions({
					owner: params.owner,
					name: params.name,
				}),
			),
		),
	// Every repo sub-page (tree/issues/pulls/commits) shares this layout route,
	// so this is the one place that can put the repo's own identity into every
	// one of those pages' title/description instead of them all showing the
	// same site-wide default — the single biggest gap for a code host where
	// individual repos are exactly the content worth being found by search.
	// SoftwareSourceCode structured data helps search engines categorize the
	// page as a repository rather than generic content (script:ld+json is
	// TanStack Router's native structured-data hook, deduped/merged the same
	// way meta tags are).
	head: ({ loaderData, params }) => {
		if (!loaderData) return {};
		const title = `${params.owner}/${params.name}`;
		const description =
			loaderData.description || `Browse the ${title} repository on PushStack.`;
		return {
			meta: [
				{ title: `${title} · PushStack` },
				{ name: "description", content: description },
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:type", content: "object" },
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{
					"script:ld+json": {
						"@context": "https://schema.org",
						"@type": "SoftwareSourceCode",
						name: params.name,
						description,
						codeRepository: `${SITE_URL}/${params.owner}/${params.name}`,
						author: {
							"@type": "Person",
							name: params.owner,
						},
					},
				},
			],
		};
	},
	component: RepositoryPage,
	notFoundComponent: RepositoryNotFound,
	errorComponent: RepositoryErrorComponent,
});

function RepositoryErrorComponent({ error, reset }: ErrorComponentProps) {
	const { owner, name } = Route.useParams();
	return (
		<div className="page-wrap px-4 py-16 text-center">
			<div className="island-shell mx-auto max-w-md rounded-xl p-8">
				<h1 className="mb-2 text-lg font-semibold text-foreground">
					Couldn't load {owner}/{name}
				</h1>
				<p className="mb-6 text-sm text-muted-foreground">
					{error instanceof Error
						? error.message
						: "An unexpected error occurred."}
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

function RepositoryNotFound() {
	return (
		<div className="page-wrap px-4 py-16">
			<div className="mx-auto max-w-md">
				<NotFoundCard
					title="Repository not found"
					message="It doesn't exist, or you don't have access to it."
					backTo="/dashboard"
					backLabel="Back to Dashboard"
				/>
			</div>
		</div>
	);
}

function RepositoryPage() {
	const { owner, name } = Route.useParams();
	const { branch } = useParams({ strict: false });
	const matchRoute = useMatchRoute();

	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const isCodeActive = Boolean(
		matchRoute({ to: "/$owner/$name/tree/$branch/$", fuzzy: true }) ||
			matchRoute({ to: "/$owner/$name/blob/$branch/$", fuzzy: true }),
	);
	const isCommitsActive = Boolean(
		matchRoute({ to: "/$owner/$name/commits/$branch", fuzzy: true }),
	);

	if (isLoading) {
		return (
			<div className="page-wrap px-4 py-8">
				<RepoHeaderSkeleton />
				<RepoTabNavSkeleton />
			</div>
		);
	}

	if (!repo) return <RepositoryNotFound />;

	const currentBranch = branch ?? repo.defaultBranch;

	// Only the code/commits views render branch-scoped (and often long-cached)
	// git data — issues/pulls/settings aren't affected by a push landing on
	// whatever branch happens to be "current", so don't watch or notify there.
	const watchingBranch = isCodeActive || isCommitsActive;

	return (
		<div className="page-wrap px-4 py-8">
			<GuestSignupBanner repoLabel={`${owner}/${name}`} />
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
	const { hasUpdate, reload, isReloading } = useBranchUpdateBanner(
		repoId,
		branchName,
	);
	if (!hasUpdate) return null;
	return (
		<BranchUpdateBanner
			branchName={branchName}
			onReload={reload}
			isReloading={isReloading}
		/>
	);
}
