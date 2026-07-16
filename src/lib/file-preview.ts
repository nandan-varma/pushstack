import { getPreviewKind } from "@/lib/language-detection";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

export function isMarkdownFile(filePath: string): boolean {
	const extension =
		(filePath.split("/").pop() || "").split(".").pop()?.toLowerCase() ?? "";
	return MARKDOWN_EXTENSIONS.has(extension);
}

export type PreviewMode = "markdown" | "binary" | null;

/**
 * Decides whether a file gets a rendered "Preview" tab alongside "Code" —
 * "markdown" renders through MarkdownRenderer, "binary" through BinaryPreview
 * (image/pdf/audio/video/font, keyed off extension via getPreviewKind).
 * Content that's binary-sniffed server-side (real null bytes) can't be a
 * markdown preview, no matter what its extension claims.
 */
export function getPreviewMode(
	filePath: string,
	isBinary: boolean,
): PreviewMode {
	if (isMarkdownFile(filePath)) return isBinary ? null : "markdown";
	if (getPreviewKind(filePath)) return "binary";
	return null;
}
