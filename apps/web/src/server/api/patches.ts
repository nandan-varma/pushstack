/**
 * The `diff` and `patch` media types of commits and comparisons: git's
 * unified diff (`git diff`) and mailbox patches (`git format-patch`). Author
 * emails are the same noreply placeholder the JSON shapes use.
 */
import {
	type CommitInfo,
	DiffLimitError,
	type DiffResult,
} from "git-fs-s3/ops";
import { apiCaps } from "./caps";
import { gitIdentity } from "./serializers";

type DiffFile = DiffResult["files"][number];

/** One file's section of a unified diff. */
function fileDiff(file: DiffFile): string {
	const header = `diff --git a/${file.path} b/${file.path}\n`;
	if (file.kind === "text") {
		return file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
	}
	if (file.kind === "submodule") {
		const before = file.oldEntry?.type === "commit" ? file.oldEntry.oid : null;
		const after = file.newEntry?.type === "commit" ? file.newEntry.oid : null;
		const lines = [
			before ? `-Subproject commit ${before}` : null,
			after ? `+Subproject commit ${after}` : null,
		].filter((line) => line !== null);
		return `${header}--- ${before ? `a/${file.path}` : "/dev/null"}\n+++ ${after ? `b/${file.path}` : "/dev/null"}\n@@ -${before ? "1" : "0,0"} +${after ? "1" : "0,0"} @@\n${lines.join("\n")}\n`;
	}
	// Binary, and text too large to diff here: git's binary summary line.
	const a = file.status === "added" ? "/dev/null" : `a/${file.path}`;
	const b = file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
	return `${header}Binary files ${a} and ${b} differ\n`;
}

/** `unifiedDiff`, one file's section at a time (for bounded streaming). */
export function* unifiedDiffSections(diff: DiffResult): Generator<string> {
	for (const file of diff.files) yield fileDiff(file);
}

/** `git diff` output for `diff`. */
export function unifiedDiff(diff: DiffResult): string {
	return diff.files.map(fileDiff).join("");
}

/**
 * A rendered diff or patch, refused (406, as GitHub answers an oversized diff)
 * past `apiCaps.diffMediaBytes`. Checked on the rendered bytes: the headers
 * the rendering adds are not in the library's own budget.
 */
export function withinDiffCap(text: string): string {
	if (new TextEncoder().encode(text).byteLength > apiCaps.diffMediaBytes) {
		throw new DiffLimitError("bytes", apiCaps.diffMediaBytes);
	}
	return text;
}

/** git's mailbox date: `Thu, 2 Jan 2020 03:04:05 +0000`. */
function mailDate(isoDate: string): string {
	return new Date(isoDate).toUTCString().replace("GMT", "+0000");
}

/** `git format-patch` output: one mailbox message per commit, oldest first. */
export function formatPatches(
	commits: Array<{ info: CommitInfo; diff: DiffResult }>,
): string {
	return commits
		.flatMap(({ info, diff }, index) => [
			...formatPatchSections(info, diff, index, commits.length),
		])
		.join("");
}

/**
 * One commit's `git format-patch` message, numbered `index + 1` of `total`,
 * in sections (header, each file's diff, trailer) for bounded streaming.
 */
export function* formatPatchSections(
	info: CommitInfo,
	diff: DiffResult,
	index: number,
	total: number,
): Generator<string> {
	const author = gitIdentity(info.commit.author);
	const [subject = "", ...rest] = info.commit.message
		.replace(/\n+$/, "")
		.split("\n");
	const body = rest.join("\n").replace(/^\n+/, "");
	const numbering = total > 1 ? `[PATCH ${index + 1}/${total}]` : "[PATCH]";
	const stat = `${diff.files.length} file${diff.files.length === 1 ? "" : "s"} changed, ${diff.totalAdditions} insertion${diff.totalAdditions === 1 ? "" : "s"}(+), ${diff.totalDeletions} deletion${diff.totalDeletions === 1 ? "" : "s"}(-)`;
	yield [
		`From ${info.oid} Mon Sep 17 00:00:00 2001`,
		`From: ${author.name} <${author.email}>`,
		`Date: ${mailDate(author.date)}`,
		`Subject: ${numbering} ${subject}`,
		"",
		...(body ? [body] : []),
		"---",
		` ${stat}`,
		"",
		"",
	].join("\n");
	yield* unifiedDiffSections(diff);
	yield "\n--\nPushStack\n\n";
}
