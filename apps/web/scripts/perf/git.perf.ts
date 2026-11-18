/**
 * Cold/warm timings for the git read path: the work every repository page
 * does before React renders. Cold is the first call in a fresh process (empty
 * caches); warm is the p50 of the following calls.
 *
 * Needs a local data dir with repositories in it (`pnpm dev:local` creates
 * one; push a repository first). Run with the dev server stopped, because
 * pglite allows one process at a time:
 *
 *   PUSHSTACK_LOCAL_DIR=.pushstack-local pnpm perf:git
 */

import { test } from "vitest";
import {
	getBlame,
	getBranchDiff,
	getBranches,
	getCommitLog,
	getFileContent,
	getFileHistory,
	getLastCommitsForTree,
	getTree,
} from "#/server/git-read";

const WARM = 15;
const OWNER = process.env.PERF_OWNER ?? "alice";
const REPO = process.env.PERF_REPO ?? "pushstack";
const LARGE_REPO = process.env.PERF_LARGE_REPO ?? "large";
const BASE = process.env.PERF_BASE ?? "main";
const BRANCH = process.env.PERF_BRANCH ?? "perf-branch-1";

function fmt(ms: number): string {
	return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

async function bench(
	name: string,
	fn: () => Promise<unknown>,
	warm = WARM,
): Promise<string> {
	const t0 = performance.now();
	await fn();
	const cold = performance.now() - t0;
	const samples: number[] = [];
	for (let i = 0; i < warm; i++) {
		const t = performance.now();
		await fn();
		samples.push(performance.now() - t);
	}
	samples.sort((a, b) => a - b);
	const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
	const p50 = samples[Math.floor(samples.length / 2)];
	return `| ${name} | ${fmt(cold)} | ${fmt(p50)} | ${fmt(mean)} |`;
}

test("git read path", async () => {
	const rows = [
		await bench("listBranches", () => getBranches(OWNER, REPO)),
		await bench("tree root", () => getTree(OWNER, REPO, BASE, "")),
		await bench("tree dir", () => getTree(OWNER, REPO, BASE, "packages")),
		await bench("file content", () =>
			getFileContent(OWNER, REPO, "README.md", BASE),
		),
		await bench("commit log depth 30", () =>
			getCommitLog(OWNER, REPO, BASE, 30),
		),
		await bench("last commits for tree", () =>
			getLastCommitsForTree(OWNER, REPO, BASE, ""),
		),
		await bench("file history", () =>
			getFileHistory(OWNER, REPO, BASE, "README.md", 20),
		),
		await bench("blame", () => getBlame(OWNER, REPO, BASE, "README.md")),
		await bench("branch diff", () => getBranchDiff(OWNER, REPO, BASE, BRANCH)),
		await bench("large: tree root", () => getTree(OWNER, LARGE_REPO, BASE, "")),
		await bench("large: tree dir", () =>
			getTree(OWNER, LARGE_REPO, BASE, "docs"),
		),
		await bench("large: commit log 30", () =>
			getCommitLog(OWNER, LARGE_REPO, BASE, 30),
		),
	];
	process.stdout.write(
		[
			`\n${OWNER}/${REPO} vs ${OWNER}/${LARGE_REPO}, warm runs: ${WARM}\n`,
			"| operation | cold | warm p50 | warm mean |",
			"|---|---|---|---|",
			...rows,
			"",
		].join("\n"),
	);
}, 300_000);
