/**
 * The one unified-diff line parser, plus the anchor helpers built on it.
 *
 * The Files tab draws a review-comment button from this parse, and the server
 * decides whether an anchor is legal from the same parse (`collectDiffAnchors`
 * derives from `parsePatch` and `anchorsForLine`), so the two can't drift: a
 * line the UI offers is a line the server accepts. Pure — no React, no DB.
 */
import type { ReviewSide } from "./review-types";

type DiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

export interface ParsedDiffLine {
	raw: string;
	kind: DiffLineKind;
	prefix: string;
	code: string;
	highlightText: string;
	oldLine: number | null;
	newLine: number | null;
}

const HUNK_HEADER_RE = /^@@\s-([0-9]+)(?:,[0-9]+)?\s\+([0-9]+)(?:,[0-9]+)?\s@@/;

function classifyLine(raw: string): DiffLineKind {
	if (raw.startsWith("@@")) return "hunk";

	if (raw.startsWith("+")) return "add";
	if (raw.startsWith("-")) return "remove";
	if (raw.startsWith("\\")) return "meta";

	return "context";
}

export function parsePatch(patch: string): ParsedDiffLine[] {
	const normalized = patch.replace(/\r\n/g, "\n");
	if (!normalized) return [];
	const rows = normalized.endsWith("\n")
		? normalized.slice(0, -1).split("\n")
		: normalized.split("\n");
	let oldLine = 1;
	let newLine = 1;
	let inHunk = false;

	const parsed: ParsedDiffLine[] = [];

	for (const raw of rows) {
		const kind = classifyLine(raw);

		if (kind === "hunk") {
			const match = raw.match(HUNK_HEADER_RE);
			if (match) {
				oldLine = Number(match[1]);
				newLine = Number(match[2]);
			}
			inHunk = true;
			parsed.push({
				raw,
				kind,
				prefix: "",
				code: raw,
				highlightText: "",
				oldLine: null,
				newLine: null,
			});
			continue;
		}

		// Unified diff metadata (file headers, modes, rename info) always
		// appears before hunks; skip it generically instead of hardcoding labels.
		if (!inHunk || kind === "meta") {
			continue;
		}

		if (kind === "add") {
			const nextNew = newLine;
			newLine += 1;
			parsed.push({
				raw,
				kind,
				prefix: "+",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: null,
				newLine: nextNew,
			});
			continue;
		}

		if (kind === "remove") {
			const nextOld = oldLine;
			oldLine += 1;
			parsed.push({
				raw,
				kind,
				prefix: "-",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: nextOld,
				newLine: null,
			});
			continue;
		}

		const nextOld = oldLine;
		const nextNew = newLine;
		oldLine += 1;
		newLine += 1;
		parsed.push({
			raw,
			kind,
			prefix: raw.startsWith(" ") ? " " : "",
			code: raw.startsWith(" ") ? raw.slice(1) : raw,
			highlightText: raw.startsWith(" ") ? raw.slice(1) : raw,
			oldLine: nextOld,
			newLine: nextNew,
		});
	}

	return parsed;
}

export interface DiffAnchor {
	path: string;
	side: ReviewSide;
	line: number;
}

/** A stable key for a diff anchor (a path may contain any character). */
export function anchorKey(anchor: DiffAnchor): string {
	return `${anchor.path}\u0000${anchor.side}\u0000${anchor.line}`;
}

export function anchorsForLine(
	path: string,
	line: ParsedDiffLine,
): DiffAnchor[] {
	const anchors: DiffAnchor[] = [];
	if (line.oldLine !== null) {
		anchors.push({ path, side: "LEFT", line: line.oldLine });
	}
	if (line.newLine !== null) {
		anchors.push({ path, side: "RIGHT", line: line.newLine });
	}
	return anchors;
}

/** The anchor a line's "+" button uses: the new side, except on a removal. */
export function primaryAnchor(
	path: string,
	line: ParsedDiffLine,
): DiffAnchor | null {
	if (line.newLine !== null) return { path, side: "RIGHT", line: line.newLine };
	if (line.oldLine !== null) return { path, side: "LEFT", line: line.oldLine };
	return null;
}

interface AnchorableDiffFile {
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
		for (const line of parsePatch(file.patch)) {
			for (const anchor of anchorsForLine(file.path, line)) {
				anchors.add(anchorKey(anchor));
			}
		}
	}
	return anchors;
}
