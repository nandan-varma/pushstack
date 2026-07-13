import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import { RepoEmptyState } from "@/components/repo/RepoEmptyState";
import { FileIcon } from "@/components/repo/tree/FileIcon";
import { FileTable } from "@/components/repo/tree/FileTable";
import { Button } from "@/components/ui/button";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryFileQueryOptions,
	repositoryFilesQueryOptions,
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
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await Promise.all([
				queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
				queryClient.ensureQueryData(
					repositoryFilesQueryOptions({
						repoId: repo.id,
						branchName: params.branch,
						path: params._splat || "",
					}),
				),
			]);
		}
	},
	errorComponent: TreeErrorComponent,
	component: TreeBrowserPage,
});

function TreeBrowserPage() {
	const { owner, name, branch: activeBranch, _splat } = Route.useParams();
	const activePath = _splat || "";
	const navigate = useNavigate();

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
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			navigate({
				to: "/repo/$owner/$name/tree/$branch/$",
				params: { owner, name, branch: e.target.value, _splat: activePath },
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

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex items-center justify-between gap-3">
				<select
					value={activeBranch}
					onChange={handleBranchChange}
					className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]/30"
				>
					{branches?.map((branch) => (
						<option key={branch.name} value={branch.name}>
							{branch.name}
							{branch.isDefault ? " (default)" : ""}
						</option>
					))}
				</select>

				<div className="flex items-center gap-2">
					<span className="text-xs text-[var(--sea-ink-soft)]">
						{files?.length || 0} files
					</span>
					<Link
						to="/repo/$owner/$name/upload"
						params={{ owner, name }}
						search={{ branch: activeBranch }}
					>
						<Button size="sm" variant="outline">
							+ Add file
						</Button>
					</Link>
				</div>
			</div>

			<PathBreadcrumb
				owner={owner}
				name={name}
				branch={activeBranch}
				filePath={activePath}
			/>

			<FileTable
				files={sortedFiles}
				owner={owner}
				name={name}
				branch={activeBranch}
				activePath={activePath}
				isLoading={isLoading}
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
						/>
					</div>
				</div>
			)}
		</div>
	);
}
