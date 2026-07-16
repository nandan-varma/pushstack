import { describe, expect, it } from "vitest";
import { isSafeHref, isSafeImageSrc } from "../MarkdownRenderer";

// Markdown link/image targets come from repo READMEs, issue bodies, PR
// bodies, and comments — all attacker-writable content rendered back to
// other viewers. isSafeHref/isSafeImageSrc are the only guard between that
// content and a raw <a href>/<img src>.
describe("isSafeHref", () => {
	it("allows relative repo paths", () => {
		expect(isSafeHref("./docs/readme.md")).toBe(true);
		expect(isSafeHref("/docs/readme.md")).toBe(true);
		expect(isSafeHref("docs/readme.md")).toBe(true);
	});

	it("allows http(s) and mailto", () => {
		expect(isSafeHref("https://example.com")).toBe(true);
		expect(isSafeHref("http://example.com")).toBe(true);
		expect(isSafeHref("mailto:a@example.com")).toBe(true);
	});

	it("rejects javascript: URIs", () => {
		expect(isSafeHref("javascript:alert(document.cookie)")).toBe(false);
	});

	it("rejects other dangerous schemes", () => {
		expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
		expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
	});

	it("rejects schemes regardless of casing/whitespace", () => {
		expect(isSafeHref("  JaVaScRiPt:alert(1)")).toBe(false);
	});

	it("allows empty string", () => {
		expect(isSafeHref("")).toBe(true);
	});

	it("allows hash-only anchors", () => {
		expect(isSafeHref("#section")).toBe(true);
	});

	it("rejects ftp scheme", () => {
		expect(isSafeHref("ftp://example.com/file")).toBe(false);
	});

	it("rejects file scheme", () => {
		expect(isSafeHref("file:///etc/passwd")).toBe(false);
	});

	it("rejects svg with script", () => {
		expect(isSafeHref("data:image/svg+xml,<script>alert(1)</script>")).toBe(
			false,
		);
	});

	it("allows whitespace-padded http", () => {
		expect(isSafeHref("  https://safe.com")).toBe(true);
	});
});

describe("isSafeImageSrc", () => {
	it("allows inline base64 images", () => {
		expect(isSafeImageSrc("data:image/png;base64,AAAA")).toBe(true);
	});

	it("allows all image subtypes", () => {
		expect(isSafeImageSrc("data:image/jpeg;base64,/9j/")).toBe(true);
		expect(isSafeImageSrc("data:image/gif;base64,R0lGODlh")).toBe(true);
		expect(isSafeImageSrc("data:image/svg+xml;base64,PHN2Zy")).toBe(true);
		expect(isSafeImageSrc("data:image/webp;base64,UklGR")).toBe(true);
	});

	it("rejects data:text/html", () => {
		expect(isSafeImageSrc("data:text/html,<script>alert(1)</script>")).toBe(
			false,
		);
	});

	it("rejects javascript:", () => {
		expect(isSafeImageSrc("javascript:alert(1)")).toBe(false);
	});

	it("allows relative paths", () => {
		expect(isSafeImageSrc("./images/photo.png")).toBe(true);
		expect(isSafeImageSrc("/static/logo.svg")).toBe(true);
	});

	it("allows http(s) URLs", () => {
		expect(isSafeImageSrc("https://example.com/image.png")).toBe(true);
	});

	it("rejects data:text/plain", () => {
		expect(isSafeImageSrc("data:text/plain;base64,hello")).toBe(false);
	});

	it("rejects vbscript scheme", () => {
		expect(isSafeImageSrc("vbscript:MsgBox(1)")).toBe(false);
	});
});
