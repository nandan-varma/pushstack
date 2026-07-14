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
});

describe("isSafeImageSrc", () => {
	it("allows inline base64 images", () => {
		expect(isSafeImageSrc("data:image/png;base64,AAAA")).toBe(true);
	});

	it("rejects data:text/html", () => {
		expect(isSafeImageSrc("data:text/html,<script>alert(1)</script>")).toBe(
			false,
		);
	});

	it("rejects javascript:", () => {
		expect(isSafeImageSrc("javascript:alert(1)")).toBe(false);
	});
});
