import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useRef } from "react";
import { Panel, PanelBody, PanelHeader } from "@/components/layout/panel";
import { FilePreview } from "@/components/repo/FilePreview";
import { ReadmeOutline } from "@/components/repo/ReadmeOutline";
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
	const contentRef = useRef<HTMLDivElement>(null);
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
			<Panel aria-busy="true">
				<PanelHeader>
					<Skeleton className="h-3.5 w-24" />
				</PanelHeader>
				<PanelBody className="sm:px-8 sm:py-7">
					<Skeleton className="h-40" />
				</PanelBody>
			</Panel>
		);
	}

	if (!readmeFile || (readmeContent && readmeContent.kind !== "text")) {
		return null;
	}

	const fileName = readmeFile.path.split("/").pop();

	return (
		<Panel aria-label={fileName}>
			<PanelHeader>
				<h2 className="flex items-center gap-2 text-sm font-semibold text-bjork-text-strong">
					<BookOpen
						aria-hidden="true"
						className="size-4 text-bjork-text-soft"
					/>
					{fileName}
				</h2>
			</PanelHeader>
			<PanelBody className="grid gap-8 sm:px-8 sm:py-7 2xl:grid-cols-[minmax(0,1fr)_200px]">
				{/* Long lines are hard to read; the text keeps a reading measure. */}
				<div ref={contentRef} className="max-w-[880px] min-w-0">
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
				<ReadmeOutline contentRef={contentRef} />
			</PanelBody>
		</Panel>
	);
}
