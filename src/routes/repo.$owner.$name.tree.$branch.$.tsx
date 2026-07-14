import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { RepoEmptyState } from "@/components/repo/RepoEmptyState";
import { CommitSummaryBar } from "@/components/repo/tree/CommitSummaryBar";
import { FileIcon } from "@/components/repo/tree/FileIcon";
import { FileTable } from "@/components/repo/tree/FileTable";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { perfMark, perfTime } from "@/lib/perf-log";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
	repositoryFileQueryOptions,
	repositoryFilesQueryOptions,
	repositoryLastCommitsQueryOptions,
} from "@/lib/query-options";

function TreeErrorComponent({ error, reset }: ErrorComponentProps) {
	const isPathNotFound =
		error instanceof Error && error.name === "GitPathNotFoundError";
	return (
		<div className="island-shell rounded-xl p-12 text-center">
			<h2 className="mb-2 text-lg font-semibold text-[var(--sea-ink)]">
				{isPathNotFound ? "Path not found" : "Could not load files"}
			</h2>
			<p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
				{isPathNotFound
					? "The file or folder you're looking for does not exist in this repository."
					: error?.message || "An unexpected error occurred."}
			</p>
			<div className="flex items-center justify-center gap-2">
				<Button size="sm" onClick={reset}>
					Try again
				</Button>
			</div>
		</div>
	);
}

export const Route = createFileRoute("/repo/$owner/$name/tree/$branch/$")({
	loader: async ({ params, context: { queryClient } }) =>
		perfTime(
			`loader tree ${params.owner}/${params.name}@${params.branch}:${params._splat || "/"}`,
			async () => {
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
				if (repo) {
					await perfTime(
						"loader: ensureQueryData [branches, files, lastCommits, commits]",
						() =>
							Promise.all([
								queryClient.ensureQueryData(
									repositoryBranchesQueryOptions(repo.id),
								),
								queryClient.ensureQueryData(
									repositoryFilesQueryOptions({
										repoId: repo.id,
										branchName: params.branch,
										path: params._splat || "",
									}),
								),
								queryClient.ensureQueryData(
									repositoryLastCommitsQueryOptions({
										repoId: repo.id,
										branchName: params.branch,
										path: params._splat || "",
									}),
								),
								queryClient.ensureQueryData(
									repositoryCommitsQueryOptions({
										repoId: repo.id,
										branchName: params.branch,
										limit: 1,
									}),
								),
							]),
					);
				}
			},
		),
	errorComponent: TreeErrorComponent,
	component: TreeBrowserPage,
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

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const { data: files, isLoading } = useQuery({
		...repositoryFilesQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: activePath,
		}),
		enabled: !!repo,
	});

	const { data: lastCommits, isLoading: lastCommitsLoading } = useQuery({
		...repositoryLastCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: activePath,
		}),
		enabled: !!repo,
	});

	const { data: latestCommits, isLoading: latestCommitLoading } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			limit: 1,
		}),
		enabled: !!repo,
	});
	const latestCommit = latestCommits?.[0];

	useEffect(() => {
		if (!isLoading && !lastCommitsLoading && !latestCommitLoading) {
			perfMark(
				`TreeBrowserPage all queries settled ${owner}/${name}@${activeBranch}`,
			);
		}
	}, [
		isLoading,
		lastCommitsLoading,
		latestCommitLoading,
		owner,
		name,
		activeBranch,
	]);

	const sortedFiles = useMemo(() => {
		if (!files) return [];
		return [...files].sort((a, b) => {
			if (a.type === "tree" && b.type !== "tree") return -1;
			if (a.type !== "tree" && b.type === "tree") return 1;
			return a.path.localeCompare(b.path);
		});
	}, [files]);

	const readmeFile = useMemo(
		() => files?.find((f) => f.type === "blob" && /^readme\.md$/i.test(f.path)),
		[files],
	);

	const { data: readmeContent } = useQuery({
		...repositoryFileQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: activeBranch,
			path: readmeFile?.path ?? "",
		}),
		enabled: !!repo && !!readmeFile,
	});

	const handleBranchChange = useCallback(
		(value: string) => {
			navigate({
				to: "/repo/$owner/$name/tree/$branch/$",
				params: { owner, name, branch: value, _splat: activePath },
				replace: true,
			});
		},
		[navigate, owner, name, activePath],
	);

	if (!repo) return null;

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

	return (
		<div className="space-y-4">
			{isCommitView && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
					<span>
						You&apos;re browsing the repository at commit{" "}
						<code className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
							{activeBranch.slice(0, 7)}
						</code>
						, not the tip of a branch.
					</span>
					<Link
						to="/repo/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: repo.defaultBranch, _splat: "" }}
						className="shrink-0 font-medium underline"
					>
						View latest ({repo.defaultBranch})
					</Link>
				</div>
			)}

			{/* Toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				{isCommitView ? (
					<code className="rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-1 text-xs font-mono text-[var(--sea-ink-soft)]">
						{activeBranch.slice(0, 7)}
					</code>
				) : (
					<Select value={activeBranch} onValueChange={handleBranchChange}>
						<SelectTrigger size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{branches?.map((branch) => (
								<SelectItem key={branch.name} value={branch.name}>
									{branch.name}
									{branch.isDefault ? " (default)" : ""}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}

				<div className="flex items-center gap-2">
					<span className="text-xs text-[var(--sea-ink-soft)]">
						{files?.length || 0} files
					</span>
					{!isCommitView && (
						<Link
							to="/repo/$owner/$name/upload"
							params={{ owner, name }}
							search={{ branch: activeBranch }}
						>
							<Button size="sm" variant="outline">
								+ Add file
							</Button>
						</Link>
					)}
				</div>
			</div>

			<PathBreadcrumb
				owner={owner}
				name={name}
				branch={activeBranch}
				filePath={activePath}
			/>

			<CommitSummaryBar
				owner={owner}
				name={name}
				branch={activeBranch}
				commit={latestCommit}
				isLoading={latestCommitLoading}
			/>

			<FileTable
				files={sortedFiles}
				owner={owner}
				name={name}
				branch={activeBranch}
				activePath={activePath}
				isLoading={isLoading}
				lastCommits={lastCommits}
				lastCommitsLoading={lastCommitsLoading}
			/>

			{readmeContent && !readmeContent.isBinary && (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5">
						<FileIcon />
						<span className="text-sm font-medium text-[var(--sea-ink)]">
							{readmeFile?.path}
						</span>
					</div>
					<div className="p-6">
						<MarkdownRenderer
							content={readmeContent.content}
							owner={owner}
							name={name}
							branch={activeBranch}
							repoId={repo?.id}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
