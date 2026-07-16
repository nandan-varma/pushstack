import { describe, expect, it } from "vitest";
import { getPreviewMode, isMarkdownFile } from "../file-preview";

describe("isMarkdownFile", () => {
	it("matches markdown extensions case-insensitively", () => {
		expect(isMarkdownFile("README.md")).toBe(true);
		expect(isMarkdownFile("docs/guide.MARKDOWN")).toBe(true);
		expect(isMarkdownFile("notes.mdx")).toBe(true);
	});

	it("does not match non-markdown extensions", () => {
		expect(isMarkdownFile("index.ts")).toBe(false);
		expect(isMarkdownFile("image.svg")).toBe(false);
	});
});

describe("getPreviewMode", () => {
	it("returns markdown for text markdown files", () => {
		expect(getPreviewMode("README.md", false)).toBe("markdown");
	});

	it("returns null for a markdown file that's binary-sniffed (e.g. embedded null bytes)", () => {
		expect(getPreviewMode("README.md", true)).toBe(null);
	});

	it("returns binary for previewable media extensions", () => {
		expect(getPreviewMode("logo.svg", false)).toBe("binary");
		expect(getPreviewMode("photo.png", true)).toBe("binary");
		expect(getPreviewMode("clip.mp4", true)).toBe("binary");
	});

	it("returns null for files with no preview representation", () => {
		expect(getPreviewMode("index.ts", false)).toBe(null);
		expect(getPreviewMode("archive.zip", true)).toBe(null);
	});
});
