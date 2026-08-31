#!/usr/bin/env tsx
/**
 * Migration Script: shared issue/PR numbering
 *
 * Assigns each repo's issues and pull requests a repo-scoped `number`,
 * interleaved by createdAt so it matches what GitHub's shared per-repo
 * counter would have produced, replacing display of the raw (global,
 * per-table) `id`. Also remaps `activities.metadata`'s `issueId`/`prId`
 * fields (used only as route params, never as a real FK) from the old id
 * to the new number, and seeds `repositories.next_issue_number` past the
 * highest assigned number so new issues/PRs continue the sequence.
 *
 * Usage: tsx scripts/backfill-issue-pr-numbers.ts [--dry-run]
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { activities, issues, pullRequests, repositories } from "../src/db/app-schema";

const DRY_RUN = process.argv.includes("--dry-run");

type NumberedRow = {
	kind: "issue" | "pr";
	id: number;
	createdAt: Date;
};

async function backfillRepo(repoId: number, nextIssueNumber: number) {
	// Not idempotent: the activities.metadata remap below matches on the old
	// id still present in the JSON. Once a repo's rows hold new numbers, a
	// second pass can wrongly match a row whose *current* number happens to
	// equal a *different* row's old id (hit this for real during testing —
	// see git history). nextIssueNumber > 1 means this repo has already been
	// numbered (by this script or by normal issue/PR creation), so skip it.
	if (nextIssueNumber > 1) {
		console.log(`repo ${repoId}: already numbered, skipping`);
		return { repoId, count: 0 };
	}

	const [repoIssues, repoPrs] = await Promise.all([
		db
			.select({ id: issues.id, createdAt: issues.createdAt })
			.from(issues)
			.where(eq(issues.repoId, repoId)),
		db
			.select({ id: pullRequests.id, createdAt: pullRequests.createdAt })
			.from(pullRequests)
			.where(eq(pullRequests.repoId, repoId)),
	]);

	const combined: NumberedRow[] = [
		...repoIssues.map((row) => ({ kind: "issue" as const, ...row })),
		...repoPrs.map((row) => ({ kind: "pr" as const, ...row })),
	].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

	if (combined.length === 0) return { repoId, count: 0 };

	// old id -> new number, per kind — used to remap activity metadata below.
	const issueNumberById = new Map<number, number>();
	const prNumberById = new Map<number, number>();

	combined.forEach((row, index) => {
		const number = index + 1;
		(row.kind === "issue" ? issueNumberById : prNumberById).set(
			row.id,
			number,
		);
	});

	console.log(
		`repo ${repoId}: assigning numbers 1..${combined.length} (${repoIssues.length} issues, ${repoPrs.length} PRs)`,
	);

	if (DRY_RUN) {
		for (const row of combined) {
			const number =
				row.kind === "issue"
					? issueNumberById.get(row.id)
					: prNumberById.get(row.id);
			console.log(`  ${row.kind} id=${row.id} -> #${number}`);
		}
		return { repoId, count: combined.length };
	}

	// neon-http has no transaction support (see git-storage docs on the
	// serverless HTTP driver) — this is a small, idempotent one-off script
	// (numbers are recomputed from createdAt each run), so sequential
	// statements without a transaction are an acceptable tradeoff here.
	for (const [id, number] of issueNumberById) {
		await db
			.update(issues)
			.set({ number })
			.where(and(eq(issues.id, id), eq(issues.repoId, repoId)));
	}
	for (const [id, number] of prNumberById) {
		await db
			.update(pullRequests)
			.set({ number })
			.where(and(eq(pullRequests.id, id), eq(pullRequests.repoId, repoId)));
	}

	await db
		.update(repositories)
		.set({ nextIssueNumber: combined.length + 1 })
		.where(eq(repositories.id, repoId));

	// activities.metadata.issueId/prId are route-param values (never a real
	// FK), written by issues.ts/pull-requests.ts/comments.ts as the old raw
	// id — remap them to the new number so existing activity-feed links keep
	// resolving. Must be one statement per table (matched via a VALUES join,
	// not N sequential per-row UPDATEs): a new number can equal a *different*
	// row's old id, so sequential updates matching on "old id still in the
	// JSON" would re-catch rows an earlier iteration in this same loop
	// already remapped.
	if (issueNumberById.size > 0) {
		const mapping = sql.join(
			[...issueNumberById].map(([id, number]) => sql`(${id}::int, ${number}::int)`),
			sql`, `,
		);
		await db.execute(sql`
			update ${activities} a
			set metadata = jsonb_set(a.metadata, '{issueId}', to_jsonb(m.number))
			from (values ${mapping}) as m(old_id, number)
			where a.repo_id = ${repoId}
			  and (a.metadata->>'issueId')::int = m.old_id
		`);
	}
	if (prNumberById.size > 0) {
		const mapping = sql.join(
			[...prNumberById].map(([id, number]) => sql`(${id}::int, ${number}::int)`),
			sql`, `,
		);
		await db.execute(sql`
			update ${activities} a
			set metadata = jsonb_set(a.metadata, '{prId}', to_jsonb(m.number))
			from (values ${mapping}) as m(old_id, number)
			where a.repo_id = ${repoId}
			  and (a.metadata->>'prId')::int = m.old_id
		`);
	}

	return { repoId, count: combined.length };
}

async function main() {
	const repos = await db
		.select({
			id: repositories.id,
			name: repositories.name,
			nextIssueNumber: repositories.nextIssueNumber,
		})
		.from(repositories);

	console.log(`Found ${repos.length} repo(s)${DRY_RUN ? " (dry run)" : ""}`);

	for (const repo of repos) {
		await backfillRepo(repo.id, repo.nextIssueNumber);
	}

	console.log("Done.");
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
