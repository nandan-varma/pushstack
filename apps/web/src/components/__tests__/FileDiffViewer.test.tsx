import { render } from "@testing-library/react";
import type { DiffFile } from "git-fs-s3/ops";
import { describe, expect, it, vi } from "vitest";
import { anchorKey, collectDiffAnchors, type DiffAnchor } from "@/lib/diff";
import { FileDiffViewer } from "../FileDiffViewer";

vi.mock("@/lib/syntax-highlight-client", () => ({
	requestHighlightTokens: vi.fn(),
}));

/** Two hunks, a removal, additions, context and a no-newline marker. */
const patch =
	"--- a/a.txt\n+++ b/a.txt\n@@ -1,4 +1,4 @@\n context\n-removed\n+added\n more\n last\n@@ -20,2 +20,3 @@\n twenty\n+twenty-one\n twenty-two\n\\ No newline at end of file\n";

describe("FileDiffViewer review anchors", () => {
	it("offers the viewer exactly the anchors the server accepts", () => {
		const files: DiffFile[] = [
			{
				path: "a.txt",
				status: "modified",
				kind: "text",
				additions: 3,
				deletions: 2,
				patch,
			},
		];

		// renderThreads receives the anchors of every rendered line — the same
		// parse the comment button is drawn from. The server derives its legal
		// anchors from that parse too, so the two sets must be identical.
		const offered: DiffAnchor[] = [];
		render(
			<FileDiffViewer
				files={files}
				renderThreads={(anchors) => {
					offered.push(...anchors);
					return null;
				}}
			/>,
		);

		expect(offered.length).toBeGreaterThan(0);
		expect(new Set(offered.map(anchorKey))).toEqual(collectDiffAnchors(files));
	});
});
