import { useQuery } from "@tanstack/react-query";
import { FilePreview } from "@/components/repo/FilePreview";
import { FileIcon } from "@/components/repo/tree/FileIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryFileQueryOptions } from "@/lib/query-options";

interface FileEntry {
	type: "tree" | "blob" | "commit";
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

export function ReadmeCard({
	owner,
	name,
	branch,
	repoId,
	readmeFile,
	filesLoading,
}: {
	owner: string;
	name: string;
	branch: string;
	repoId?: number;
	readmeFile: FileEntry | undefined;
	/** Whether the directory listing readmeFile is derived from is still loading — until it resolves, whether a README exists at all is unknown. */
	filesLoading?: boolean;
}) {
	const { data: readmeContent, isLoading } = useQuery({
		...repositoryFileQueryOptions({
			repoId: repoId ?? 0,
			branchName: branch,
			path: readmeFile?.path ?? "",
		}),
		enabled: !!repoId && !!readmeFile,
	});

	// Most non-empty repos have a README, so speculatively reserve its shape
	// while `files` is still loading rather than have it pop in afterward —
	// same reasoning as the rest of the tree page's skeletons. Once `files`
	// resolves, this collapses immediately to nothing if there isn't one.
	if (filesLoading) {
		return (
			<div className="island-shell overflow-hidden rounded-[18px]">
				<div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
					<div className="h-4 w-4 animate-pulse rounded bg-muted" />
					<div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
				</div>
				<div className="p-5 sm:p-8">
					<Skeleton className="h-40" />
				</div>
			</div>
		);
	}

	if (!readmeFile || (readmeContent && readmeContent.kind !== "text")) {
		return null;
	}

	return (
		<div className="island-shell overflow-hidden rounded-[18px]">
			<div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
				<FileIcon />
				<span className="text-sm font-medium text-foreground">
					{readmeFile.path}
				</span>
			</div>
			<div className="p-5 sm:p-8">
				{readmeContent ? (
					<FilePreview
						file={readmeContent}
						filePath={readmeFile.path}
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
