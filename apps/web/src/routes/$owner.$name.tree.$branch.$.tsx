import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	useNavigate,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Toolbar } from "@/components/layout/page";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { findReadmeFile, ReadmeCard } from "@/components/repo/ReadmeCard";
import { RefSelect } from "@/components/repo/RefSelect";
import { RepoEmptyState } from "@/components/repo/RepoEmptyState";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { CommitSummaryBar } from "@/components/repo/tree/CommitSummaryBar";
import { FileTable } from "@/components/repo/tree/FileTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { perfMark, perfTime } from "@/lib/perf-log";
import {
	repositoryByNameQueryOptions,
	repositoryFileQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryLastCommitsQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
	repositoryTreePageQueryOptions,
} from "@/lib/query-options";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

function TreeErrorComponent({ error, reset }: ErrorComponentProps) {
	const isPathNotFound =
		error instanceof Error && error.name === "GitPathNotFoundError";
	if (isPathNotFound) {
		return (
			<ErrorPanel
				title="Path not found"
				description="The file or folder you're looking for does not exist in this repository."
				actions={<Button onClick={reset}>Try again</Button>}
			/>
		);
	}
	return (
		<ErrorPanel
			title="Could not load files"
			description="The repository's git data could not be read. This is usually a storage connection or credentials problem, not a problem with the repository itself."
			detail={error instanceof Error ? error.message : undefined}
			actions={<Button onClick={reset}>Try again</Button>}
		/>
	);
}

export const Route = createFileRoute("/$owner/$name/tree/$branch/$")({
	loader: async ({ params, context: { queryClient } }) =>
		perfTime(
			`loader tree ${params.owner}/${params.name}@${params.branch}:${params._splat || "/"}`,
			async () => {
				// `repo` and the tree page are awaited; everything else is
				// fire-and-forget, and each section's own useQuery (sharing these
				// in-flight requests) streams in as its query settles.
				const repo = await perfTime(
					"loader: ensureQueryData repositoryByName",
					() =>
						queryClient.ensureQueryData(
							repositoryByNameQueryOptions({
								owner: params.owner,
								name: params.name,
							}),
						),
				);

				// MarkdownRenderer (which renders the README below) needs these to
				// resolve `#123` references to issue/PR links.
				queryClient
					.ensureQueryData(repositoryIssueNumbersQueryOptions(repo.id))
					.catch(() => {});
				queryClient
					.ensureQueryData(repositoryPullRequestNumbersQueryOptions(repo.id))
					.catch(() => {});

				// Awaited: it's the existence check for the branch and path — a
				// missing one throws notFound() (a 404) before the page commits —
				// and server-rendering the listing beats a skeleton. The README
				// fetch chained off it stays fire-and-forget.
				const { files } = await queryClient.ensureQueryData(
					repositoryTreePageQueryOptions({
						repoId: repo.id,
						branchName: params.branch,
						path: params._splat || "",
					}),
				);
				const readmeFile = findReadmeFile(files);
				if (readmeFile) {
					queryClient
						.ensureQueryData(
							repositoryFileQueryOptions({
								repoId: repo.id,
								branchName: params.branch,
								path: readmeFile.path,
							}),
						)
						.catch(() => {});
				}
			},
		),
	head: ({ params }) => {
		const path = params._splat ? `/${params._splat}` : "";
		const url = `${SITE_URL}/${params.owner}/${params.name}/tree/${params.branch}${path}`;
		return {
			links: [{ rel: "canonical", href: url }],
			meta: [{ property: "og:url", content: url }],
		};
	},
	errorComponent: TreeErrorComponent,
	component: TreeBrowserPage,
	notFoundComponent: () => (
		<RepoResourceNotFound
			title="Not found"
			message="This branch or folder doesn't exist."
		/>
	),
});

function TreeBrowserPage() {
	const { owner, name, branch: activeBranch, _splat } = Route.useParams();
	const activePath = _splat || "";
	const navigate = useNavigate();

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only marker, deliberately fires once
	useEffect(() => {
		perfMark(`TreeBrowserPage mounted ${owner}/${name}@${activeBranch}`);
	}, []);

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const {
		data: treePage,
		isLoading,
		isError: treePageErrored,
		error: treePageError,
		refetch: refetchTreePage,
	} = useQuery({
		...repositoryTreePageQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: activePath,
		}),
		enabled: !!repo,
	});
	const files = treePage?.files;
	const branches = treePage?.branches;
	const latestCommit = treePage?.latestCommit;

	const showLastCommitColumn = !!repo?.showLastCommitColumn;

	const { data: lastCommits, isLoading: lastCommitsLoading } = useQuery({
		...repositoryLastCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: activePath,
		}),
		// Computing this column needs an exact history walk. Start only once the
		// directory itself is visible, so it cannot contend with the critical
		// tree/readme/latest-commit R2 work on a cold navigation.
		enabled: !!repo && showLastCommitColumn && !!files,
	});

	useEffect(() => {
		if (!isLoading && !lastCommitsLoading) {
			perfMark(
				`TreeBrowserPage all queries settled ${owner}/${name}@${activeBranch}`,
			);
		}
	}, [isLoading, lastCommitsLoading, owner, name, activeBranch]);

	const sortedFiles = useMemo(() => {
		if (!files) return [];
		return [...files].sort((a, b) => {
			if (a.type === "tree" && b.type !== "tree") return -1;
			if (a.type !== "tree" && b.type === "tree") return 1;
			return a.path.localeCompare(b.path);
		});
	}, [files]);

	const readmeFile = useMemo(() => findReadmeFile(files), [files]);

	const handleBranchChange = useCallback(
		(value: string) => {
			navigate({
				to: "/$owner/$name/tree/$branch/$",
				params: { owner, name, branch: value, _splat: activePath },
				replace: true,
			});
		},
		[navigate, owner, name, activePath],
	);

	if (!repo) return null;

	// A failed tree-page query also leaves `files`/`branches` undefined,
	// same as a genuinely empty repo — without checking isError separately,
	// the isEmpty branch below can't tell "nothing here" from "couldn't load
	// what's here" and shows the wrong one (an onboarding "push your first
	// commit" screen for a repo that already has commits, instead of a real,
	// retryable error).
	if (treePageErrored) {
		return (
			<TreeErrorComponent
				error={treePageError as Error}
				reset={() => refetchTreePage()}
			/>
		);
	}

	const isEmpty =
		!branches || branches.length === 0 || !files || files.length === 0;

	if (isEmpty && !isLoading) {
		return <RepoEmptyState owner={owner} name={name} branch={activeBranch} />;
	}

	// A ref that's a raw commit sha (not one of the repo's branch names) means
	// we're browsing the repository as it looked at that specific commit,
	// same idea as GitHub's "Browsing history at this point" view.
	const isCommitView =
		/^[0-9a-f]{40}$/i.test(activeBranch) &&
		!branches?.some((b) => b.name === activeBranch);
	// Only a branch can take a new commit; a tag or commit view is read-only.
	const isBranchView = !!branches?.some((b) => b.name === activeBranch);

	const toolbar = (
		<Toolbar>
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				{!isCommitView && !isLoading && (
					<div className="lg:hidden">
						<RefSelect
							repoId={repo.id}
							value={activeBranch}
							onChange={handleBranchChange}
						/>
					</div>
				)}
				{activePath ? (
					<PathBreadcrumb
						owner={owner}
						name={name}
						branch={activeBranch}
						filePath={activePath}
						asHeading
					/>
				) : (
					<h1 className="flex min-w-0 items-baseline gap-2 text-[15px] font-semibold text-bjork-text">
						{name}
						{repo.description && (
							<span className="truncate text-sm font-normal text-bjork-text-soft">
								{repo.description}
							</span>
						)}
					</h1>
				)}
			</div>
			{isBranchView && (
				<Link
					to="/$owner/$name/upload"
					params={{ owner, name }}
					search={{ branch: activeBranch }}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					<Plus aria-hidden="true" />
					Add file
				</Link>
			)}
		</Toolbar>
	);

	// Until the listing arrives a README is the likely case, so reserve for it.
	const leadWithReadme = isLoading || Boolean(readmeFile);

	const content = (
		<>
			{isCommitView && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-warning-border bg-warning-soft px-4 py-2.5 text-sm text-warning">
					<span>
						Browsing the repository at commit{" "}
						<code className="font-mono text-xs">
							{activeBranch.slice(0, 7)}
						</code>
						, not the tip of a branch.
					</span>
					<Link
						to="/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: repo.defaultBranch, _splat: "" }}
						className="shrink-0 font-medium underline underline-offset-2"
					>
						View latest ({repo.defaultBranch})
					</Link>
				</div>
			)}
			{toolbar}
			{/* Beside the file tree, a second file list only repeats it: wide
			    screens lead with the latest commit and the README instead. */}
			<div
				className={cn(
					"hidden min-h-12 items-center rounded-[18px] border border-bjork-border-muted bg-bjork-surface px-5 py-2.5 shadow-(--bjork-shadow-soft)",
					leadWithReadme && "lg:flex",
				)}
			>
				<CommitSummaryBar
					owner={owner}
					name={name}
					branch={activeBranch}
					commit={latestCommit}
					isLoading={isLoading}
				/>
			</div>
			<FileTable
				className={leadWithReadme ? "lg:hidden" : undefined}
				files={sortedFiles}
				owner={owner}
				name={name}
				branch={activeBranch}
				activePath={activePath}
				isLoading={isLoading}
				showLastCommit={showLastCommitColumn}
				lastCommits={lastCommits}
				lastCommitsLoading={lastCommitsLoading}
				header={
					<CommitSummaryBar
						owner={owner}
						name={name}
						branch={activeBranch}
						commit={latestCommit}
						isLoading={isLoading}
					/>
				}
			/>
			<ReadmeCard
				owner={owner}
				name={name}
				branch={activeBranch}
				repoId={repo?.id}
				readmeFile={readmeFile}
				filesLoading={isLoading}
			/>
		</>
	);

	return content;
}
