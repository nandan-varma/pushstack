/**
 * Where a review comment can be anchored in a diff. Shared by the server
 * (which rejects an anchor outside the pull request's diff) and the Files tab
 * (which offers a comment button on the lines that are commentable), so both
 * agree on what "a line in the diff" means.
 */
import type { ReviewSide } from "./review-types";

export interface DiffAnchor {
	path: string;
	side: ReviewSide;
	line: number;
}

/** A stable key for a diff anchor (a path may contain any character). */
export function anchorKey(anchor: DiffAnchor): string {
	return `${anchor.path}\u0000${anchor.side}\u0000${anchor.line}`;
}

const HUNK_HEADER_RE = /^@@\s-(\d+)(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@/;

/** The part of a diff file anchor collection needs. */
export interface AnchorableDiffFile {
	path: string;
	kind: string;
	patch: string;
}

/**
 * Every `(path, side, line)` a comment can attach to: context lines on both
 * sides, an addition on the right, a removal on the left. Binary, too-large
 * and submodule files have no patch and so no line anchors.
 */
export function collectDiffAnchors(
	files: readonly AnchorableDiffFile[],
): Set<string> {
	const anchors = new Set<string>();
	for (const file of files) {
		if (file.kind !== "text" || !file.patch) continue;
		const patch = file.patch.replace(/\r\n/g, "\n");
		const rows = patch.endsWith("\n")
			? patch.slice(0, -1).split("\n")
			: patch.split("\n");
		let oldLine = 1;
		let newLine = 1;
		let inHunk = false;

		for (const raw of rows) {
			if (raw.startsWith("@@")) {
				const match = raw.match(HUNK_HEADER_RE);
				if (match) {
					oldLine = Number(match[1]);
					newLine = Number(match[2]);
				}
				inHunk = true;
				continue;
			}
			// File headers ("--- a/…", "+++ b/…") precede the first hunk, and
			// "\ No newline at end of file" isn't a line either.
			if (!inHunk || raw.startsWith("\\")) continue;

			if (raw.startsWith("+")) {
				anchors.add(
					anchorKey({ path: file.path, side: "RIGHT", line: newLine }),
				);
				newLine += 1;
			} else if (raw.startsWith("-")) {
				anchors.add(
					anchorKey({ path: file.path, side: "LEFT", line: oldLine }),
				);
				oldLine += 1;
			} else {
				anchors.add(
					anchorKey({ path: file.path, side: "LEFT", line: oldLine }),
				);
				anchors.add(
					anchorKey({ path: file.path, side: "RIGHT", line: newLine }),
				);
				oldLine += 1;
				newLine += 1;
			}
		}
	}
	return anchors;
}
