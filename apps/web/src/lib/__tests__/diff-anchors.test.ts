import { describe, expect, it } from "vitest";
import { anchorKey, collectDiffAnchors } from "../diff-anchors";

const key = (path: string, side: "LEFT" | "RIGHT", line: number) =>
	anchorKey({ path, side, line });

describe("collectDiffAnchors", () => {
	it("offers both sides of context, the right of an addition and the left of a removal", () => {
		const anchors = collectDiffAnchors([
			{
				path: "a.txt",
				kind: "text",
				patch: "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n",
			},
		]);
		expect([...anchors].sort()).toEqual(
			[
				key("a.txt", "LEFT", 1),
				key("a.txt", "RIGHT", 1),
				key("a.txt", "LEFT", 2),
				key("a.txt", "RIGHT", 2),
				key("a.txt", "LEFT", 3),
				key("a.txt", "RIGHT", 3),
			].sort(),
		);
	});

	it("offers only the right of a pure addition and only the left of a pure removal", () => {
		expect([
			...collectDiffAnchors([
				{ path: "new.txt", kind: "text", patch: "@@ -0,0 +1 @@\n+hello\n" },
			]),
		]).toEqual([key("new.txt", "RIGHT", 1)]);
		expect([
			...collectDiffAnchors([
				{ path: "gone.txt", kind: "text", patch: "@@ -1 +0,0 @@\n-bye\n" },
			]),
		]).toEqual([key("gone.txt", "LEFT", 1)]);
	});

	it("ignores file headers and the no-newline marker", () => {
		const anchors = collectDiffAnchors([
			{
				path: "a.txt",
				kind: "text",
				patch:
					"--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n",
			},
		]);
		expect([...anchors].sort()).toEqual(
			[key("a.txt", "LEFT", 1), key("a.txt", "RIGHT", 1)].sort(),
		);
	});

	it("has no anchors for a file with no text patch", () => {
		expect(
			collectDiffAnchors([{ path: "logo.png", kind: "binary", patch: "" }]),
		).toEqual(new Set());
	});
});
