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
		expect(getPreviewMode("README.md", "text")).toBe("markdown");
	});

	it("returns null for a markdown file that's binary-sniffed (e.g. embedded null bytes)", () => {
		expect(getPreviewMode("README.md", "binary")).toBe(null);
	});

	it("returns binary for previewable media extensions", () => {
		expect(getPreviewMode("logo.svg", "text")).toBe("media");
		expect(getPreviewMode("photo.png", "binary")).toBe("media");
		expect(getPreviewMode("clip.mp4", "too-large")).toBe("media");
	});

	it("returns null for files with no preview representation", () => {
		expect(getPreviewMode("index.ts", "text")).toBe(null);
		expect(getPreviewMode("archive.zip", "binary")).toBe(null);
	});
});
