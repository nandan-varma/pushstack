import { describe, expect, it } from "vitest";
import {
	detectLanguage,
	formatFileSize,
	getMimeType,
	getPreviewKind,
	isLargeContent,
	MAX_AUTO_HIGHLIGHT_LINES,
} from "../language-detection";

describe("isLargeContent", () => {
	it("returns false for empty and small strings", () => {
		expect(isLargeContent("")).toBe(false);
		expect(isLargeContent("hello")).toBe(false);
	});

	it("returns true for content exceeding byte limit", () => {
		expect(isLargeContent("a".repeat(MAX_AUTO_HIGHLIGHT_LINES * 2))).toBe(
			false,
		);
		expect(isLargeContent("a".repeat(512 * 1024 + 1))).toBe(true);
	});

	it("returns true when line count exceeds limit", () => {
		const lines = Array.from(
			{ length: MAX_AUTO_HIGHLIGHT_LINES + 1 },
			() => "x",
		).join("\n");
		expect(isLargeContent(lines)).toBe(true);
	});

	it("returns false at exactly the line limit", () => {
		const lines = Array.from(
			{ length: MAX_AUTO_HIGHLIGHT_LINES },
			() => "x",
		).join("\n");
		expect(isLargeContent(lines)).toBe(false);
	});

	it("counts \\r\\n as one line break each", () => {
		const content = "x\r\n".repeat(MAX_AUTO_HIGHLIGHT_LINES + 1);
		expect(isLargeContent(content)).toBe(true);
	});
});

describe("detectLanguage", () => {
	it("detects language from well-known extensions", () => {
		expect(detectLanguage("index.ts")).toBe("typescript");
		expect(detectLanguage("app.tsx")).toBe("tsx");
		expect(detectLanguage("style.css")).toBe("css");
		expect(detectLanguage("readme.md")).toBe("markdown");
		expect(detectLanguage("main.go")).toBe("go");
		expect(detectLanguage("lib.rs")).toBe("rust");
		expect(detectLanguage("app.py")).toBe("python");
	});

	it("detects language from special filenames (case-insensitive)", () => {
		expect(detectLanguage("Dockerfile")).toBe("docker");
		expect(detectLanguage("dockerfile.dev")).toBe("docker");
		expect(detectLanguage("Makefile")).toBe("make");
		expect(detectLanguage("Gemfile")).toBe("ruby");
		expect(detectLanguage("cmakelists")).toBe("cmake");
		expect(detectLanguage("Justfile")).toBe("just");
		expect(detectLanguage("Rakefile")).toBe("ruby");
	});

	it("detects dotfiles with special handling", () => {
		expect(detectLanguage(".gitignore")).toBe("shellscript");
		expect(detectLanguage(".gitattributes")).toBe("shellscript");
		expect(detectLanguage(".dockerignore")).toBe("shellscript");
		expect(detectLanguage(".env")).toBe("dotenv");
		expect(detectLanguage(".env.local")).toBe("dotenv");
		expect(detectLanguage(".editorconfig")).toBe("ini");
		expect(detectLanguage(".npmrc")).toBe("ini");
		expect(detectLanguage(".babelrc")).toBe("json");
		expect(detectLanguage(".eslintrc")).toBe("json");
	});

	it("handles files with path prefixes", () => {
		expect(detectLanguage("src/components/App.tsx")).toBe("tsx");
		expect(detectLanguage("deeply/nested/dir/file.rs")).toBe("rust");
		expect(detectLanguage("/abs/path/to/makefile")).toBe("make");
	});

	it("returns plaintext for unknown extensions", () => {
		expect(detectLanguage("file.xyz")).toBe("plaintext");
		expect(detectLanguage("noextension")).toBe("plaintext");
	});

	it("handles case-insensitive extensions", () => {
		expect(detectLanguage("file.TS")).toBe("typescript");
		expect(detectLanguage("file.PY")).toBe("python");
		expect(detectLanguage("file.GO")).toBe("go");
	});
});

describe("getMimeType", () => {
	it("returns correct MIME types for known extensions", () => {
		expect(getMimeType("image.png")).toBe("image/png");
		expect(getMimeType("video.mp4")).toBe("video/mp4");
		expect(getMimeType("doc.pdf")).toBe("application/pdf");
		expect(getMimeType("font.woff2")).toBe("font/woff2");
		expect(getMimeType("audio.wav")).toBe("audio/wav");
	});

	it("returns octet-stream for unknown extensions", () => {
		expect(getMimeType("file.xyz")).toBe("application/octet-stream");
	});

	it("handles paths with directories", () => {
		expect(getMimeType("src/assets/photo.webp")).toBe("image/webp");
	});

	it("is case-insensitive on extensions", () => {
		expect(getMimeType("image.PNG")).toBe("image/png");
		expect(getMimeType("doc.PDF")).toBe("application/pdf");
	});
});

describe("getPreviewKind", () => {
	it("classifies image files", () => {
		expect(getPreviewKind("photo.jpg")).toBe("image");
		expect(getPreviewKind("icon.svg")).toBe("image");
		expect(getPreviewKind("banner.webp")).toBe("image");
	});

	it("classifies PDF files", () => {
		expect(getPreviewKind("doc.pdf")).toBe("pdf");
	});

	it("classifies audio files", () => {
		expect(getPreviewKind("song.mp3")).toBe("audio");
		expect(getPreviewKind("podcast.ogg")).toBe("audio");
	});

	it("classifies video files", () => {
		expect(getPreviewKind("clip.mp4")).toBe("video");
	});

	it("classifies font files", () => {
		expect(getPreviewKind("font.woff2")).toBe("font");
	});

	it("returns null for non-previewable files", () => {
		expect(getPreviewKind("index.ts")).toBe(null);
		expect(getPreviewKind("style.css")).toBe(null);
		expect(getPreviewKind("archive.zip")).toBe(null);
	});

	it("classifies the extensions the old binary list disagreed about", () => {
		// webp/avif/ogg/flac/m4a/webm/otf were missing from the deleted
		// isBinaryFile list while MIME_TYPE_MAP knew them, so the two
		// classifications disagreed about the same file. One table answers
		// both now, and this pins the cases that used to drift.
		expect(getPreviewKind("logo.avif")).toBe("image");
		expect(getPreviewKind("clip.webm")).toBe("video");
		expect(getPreviewKind("track.flac")).toBe("audio");
		expect(getPreviewKind("voice.m4a")).toBe("audio");
		expect(getPreviewKind("face.otf")).toBe("font");
	});
});

describe("formatFileSize", () => {
	it("formats zero bytes", () => {
		expect(formatFileSize(0)).toBe("0 B");
	});

	it("formats bytes, KB, MB, GB", () => {
		expect(formatFileSize(512)).toBe("512 B");
		expect(formatFileSize(1024)).toBe("1 KB");
		expect(formatFileSize(1536)).toBe("1.5 KB");
		expect(formatFileSize(1048576)).toBe("1 MB");
		expect(formatFileSize(1073741824)).toBe("1 GB");
	});

	it("rounds to two decimal places", () => {
		expect(formatFileSize(1234567)).toBe("1.18 MB");
	});
});
