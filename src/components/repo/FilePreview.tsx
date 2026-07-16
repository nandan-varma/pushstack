import { lazy, Suspense } from "react";
import { BinaryPreview } from "@/components/BinaryPreview";
import { Skeleton } from "@/components/ui/skeleton";
import { toPreviewBase64 } from "@/lib/binary-preview";
import { getPreviewMode } from "@/lib/file-preview";
import { getMimeType, getPreviewKind } from "@/lib/language-detection";

// Shared by the README card (tree pages, any directory) and the file blob
// page's Preview tab — react-markdown/remark-gfm/rehype-highlight are lazy
// loaded here so neither call site pays for them unless the file is actually
// markdown.
const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

interface FilePreviewProps {
	filePath: string;
	content: string;
	isBinary: boolean;
	owner?: string;
	name?: string;
	branch?: string;
	repoId?: number;
	className?: string;
}

/** Renders a file as its previewable form (markdown or binary media). Returns null if not previewable — check `getPreviewMode` first to decide whether to show a Preview tab/section at all. */
export function FilePreview({
	filePath,
	content,
	isBinary,
	owner,
	name,
	branch,
	repoId,
	className,
}: FilePreviewProps) {
	const mode = getPreviewMode(filePath, isBinary);

	if (mode === "markdown") {
		return (
			<Suspense fallback={<Skeleton className="h-40" />}>
				<MarkdownRenderer
					content={content}
					owner={owner}
					name={name}
					branch={branch}
					repoId={repoId}
					className={className}
				/>
			</Suspense>
		);
	}

	const previewKind = mode === "binary" ? getPreviewKind(filePath) : null;
	if (!previewKind) return null;

	return (
		<BinaryPreview
			data={toPreviewBase64(content, isBinary)}
			mimeType={getMimeType(filePath)}
			previewKind={previewKind}
			fileName={filePath}
		/>
	);
}
