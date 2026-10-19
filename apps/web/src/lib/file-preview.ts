import type { FileView } from "@/lib/file-view";
import { getPreviewKind } from "@/lib/language-detection";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

export function isMarkdownFile(filePath: string): boolean {
	const extension =
		(filePath.split("/").pop() || "").split(".").pop()?.toLowerCase() ?? "";
	return MARKDOWN_EXTENSIONS.has(extension);
}

export type PreviewMode = "markdown" | "media" | null;

/**
 * Decides whether a file gets a rendered "Preview" tab alongside "Code" —
 * "markdown" renders through MarkdownRenderer (only text that's displayed
 * inline), "media" through BinaryPreview (image/pdf/audio/video/font, keyed
 * off extension via getPreviewKind).
 */
export function getPreviewMode(
	filePath: string,
	kind: FileView["kind"],
): PreviewMode {
	if (kind === "submodule") return null;
	if (isMarkdownFile(filePath)) return kind === "text" ? "markdown" : null;
	if (getPreviewKind(filePath)) return "media";
	return null;
}
