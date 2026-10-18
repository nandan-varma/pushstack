/**
 * One-off profiling script (not part of the app) — calls the tree-page's
 * underlying git-read functions directly, bypassing createServerFn's
 * request-context requirement (these scripts have no real HTTP request),
 * to exercise the real DB+R2 read path with perf-log.ts's server-side
 * instrumentation active. Mirrors what the tree route loader fires on a
 * cold page load (see files.ts's handlers).
 */
import {
	getBranches,
	getCommitLog,
	getLastCommitsForTree,
	getTree,
} from "#/server/git-read";
import { perfContext } from "#/server/perf-log";

const OWNER = "perfuser";
const REPO = "perf-repo";

async function main() {
	console.log("\n--- sequential (cold) ---");
	await perfContext("PAGE: getBranches", () => getBranches(OWNER, REPO));
	await perfContext("PAGE: getTree (root)", () =>
		getTree(OWNER, REPO, "main", ""),
	);
	await perfContext("PAGE: getCommitLog (limit 1, CommitSummaryBar)", () =>
		getCommitLog(OWNER, REPO, "main", 1),
	);
	await perfContext("PAGE: getLastCommitsForTree (root)", () =>
		getLastCommitsForTree(OWNER, REPO, "main", ""),
	);

	console.log("\n--- parallel, as a real page load fires them (warm cache) ---");
	await Promise.all([
		perfContext("PAGE: getBranches (warm, parallel)", () =>
			getBranches(OWNER, REPO),
		),
		perfContext("PAGE: getTree (warm, parallel)", () =>
			getTree(OWNER, REPO, "main", ""),
		),
		perfContext("PAGE: getCommitLog (warm, parallel)", () =>
			getCommitLog(OWNER, REPO, "main", 1),
		),
		perfContext("PAGE: getLastCommitsForTree (warm, parallel)", () =>
			getLastCommitsForTree(OWNER, REPO, "main", ""),
		),
	]);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
