import { useQuery } from "@tanstack/react-query";
import { FilePreview } from "@/components/repo/FilePreview";
import { FileIcon } from "@/components/repo/tree/FileIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryFileQueryOptions } from "@/lib/query-options";

interface FileEntry {
	type: "tree" | "blob";
	path: string;
}

/**
 * Finds the README in a directory's file listing. `files` is scoped to one
 * directory already (whatever path the caller queried), so matching against
 * the basename — not the full repo-relative path — is what makes this work
 * for any directory, not just the repo root.
 */
export function findReadmeFile<T extends FileEntry>(
	files: T[] | undefined,
): T | undefined {
	return files?.find(
		(f) =>
			f.type === "blob" && /^readme\.md$/i.test(f.path.split("/").pop() || ""),
	);
}

/**
 * Renders the README for the current directory, same as GitHub's repo/tree
 * "readme below the file list" panel. Reused by the tree page at every depth
 * — root and nested directories alike — so it only depends on the resolved
 * readme file entry, not on being at the repo root.
 */
export function ReadmeCard({
	owner,
	name,
	branch,
	repoId,
	readmeFile,
}: {
	owner: string;
	name: string;
	branch: string;
	repoId?: number;
	readmeFile: FileEntry | undefined;
}) {
	const { data: readmeContent, isLoading } = useQuery({
		...repositoryFileQueryOptions({
			repoId: repoId ?? 0,
			branchName: branch,
			path: readmeFile?.path ?? "",
		}),
		enabled: !!repoId && !!readmeFile,
	});

	if (!readmeFile || readmeContent?.isBinary) return null;

	return (
		<div className="overflow-hidden rounded-xl border border-[var(--line)]">
			<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5">
				<FileIcon />
				<span className="text-sm font-medium text-[var(--sea-ink)]">
					{readmeFile.path}
				</span>
			</div>
			<div className="p-6">
				{readmeContent ? (
					<FilePreview
						filePath={readmeFile.path}
						content={readmeContent.content}
						isBinary={readmeContent.isBinary}
						owner={owner}
						name={name}
						branch={branch}
						repoId={repoId}
					/>
				) : (
					isLoading && <Skeleton className="h-40" />
				)}
			</div>
		</div>
	);
}
