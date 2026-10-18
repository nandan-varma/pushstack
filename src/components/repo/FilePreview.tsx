import { lazy, Suspense } from "react";
import { BinaryPreview } from "@/components/BinaryPreview";
import { Skeleton } from "@/components/ui/skeleton";
import { useTextObjectUrl } from "@/lib/binary-preview";
import { getPreviewMode } from "@/lib/file-preview";
import { type FileView, rawFileUrl } from "@/lib/file-view";
import { getMimeType, getPreviewKind } from "@/lib/language-detection";

// Shared by the README card (tree pages, any directory) and the file blob
// page's Preview tab — react-markdown/remark-gfm/rehype-highlight are lazy
// loaded here so neither call site pays for them unless the file is actually
// markdown.
const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

interface FilePreviewProps {
	file: FileView;
	filePath: string;
	owner: string;
	name: string;
	branch: string;
	repoId?: number;
	className?: string;
}

/** Renders a file as its previewable form (markdown or media). Returns null if not previewable — check `getPreviewMode` first to decide whether to show a Preview tab/section at all. */
export function FilePreview({
	file,
	filePath,
	owner,
	name,
	branch,
	repoId,
	className,
}: FilePreviewProps) {
	const mode = getPreviewMode(filePath, file.kind);
	const previewKind = mode === "media" ? getPreviewKind(filePath) : null;
	// Media stored as text (an SVG) previews from an object URL; anything
	// else is fetched from the raw endpoint only now that it's displayed.
	const textMediaUrl = useTextObjectUrl(
		previewKind && file.kind === "text" ? file.content : undefined,
		getMimeType(filePath),
	);

	if (mode === "markdown" && file.kind === "text") {
		return (
			<Suspense fallback={<Skeleton className="h-40" />}>
				<MarkdownRenderer
					content={file.content}
					owner={owner}
					name={name}
					branch={branch}
					filePath={filePath}
					repoId={repoId}
					className={className}
				/>
			</Suspense>
		);
	}

	if (!previewKind) return null;

	return (
		<BinaryPreview
			src={
				file.kind === "text"
					? textMediaUrl
					: rawFileUrl({ owner, name, ref: branch, path: filePath })
			}
			previewKind={previewKind}
			fileName={filePath}
		/>
	);
}
