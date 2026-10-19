/**
 * Commit references after a push, as GitHub does them: every `#N` in a newly
 * pushed commit message adds a `referenced` event to thread #N, and on the
 * default branch a closing keyword ("Fixes #N") closes the issue, recording
 * the commit as the closer.
 *
 * Runs inside the push's repo lock, so it is bounded: at most
 * `MAX_PUSH_COMMITS` commits are examined and the database work is a fixed
 * handful of batched queries however many commits or refs were pushed.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { RefUpdateCommand, RefUpdateResult } from "git-fs-s3/http";
import { db } from "#/db";
import { issues, pullRequests, timelineEvents } from "#/db/app-schema";
import {
	getClosingIssueNumbers,
	getReferencedIssueNumbers,
} from "#/lib/issue-references";
import type { TimelineEvent } from "#/lib/timeline-types";
import { recordActivity } from "./activity";
import { getCommitLog } from "./git-read";

/** Newest commits examined per pushed ref. */
export const MAX_PUSH_COMMITS = 100;
const ZERO_OID = "0".repeat(40);
const MESSAGE_PREVIEW_CHARS = 200;

interface PushedCommit {
	sha: string;
	message: string;
}

/** Commits `newOid` has that `exclude` (a sha or branch) doesn't; newest first. */
async function newCommits(
	ownerKey: string,
	repoName: string,
	newOid: string,
	exclude: string | null,
): Promise<PushedCommit[]> {
	const [head, known] = await Promise.all([
		getCommitLog(ownerKey, repoName, newOid, MAX_PUSH_COMMITS),
		exclude
			? getCommitLog(ownerKey, repoName, exclude, MAX_PUSH_COMMITS).catch(
					() => [],
				)
			: Promise.resolve([]),
	]);
	const knownShas = new Set(known.map((commit) => commit.oid));
	return head
		.filter((commit) => !knownShas.has(commit.oid))
		.map((commit) => ({ sha: commit.oid, message: commit.commit.message }));
}

/**
 * Record references and closings for a push's successful ref updates.
 * `actorId` is the pusher. Never throws into the push: callers log failures.
 */
export async function recordPushReferences(input: {
	ownerKey: string;
	repoName: string;
	repoId: number;
	defaultBranch: string;
	actorId: string;
	updates: RefUpdateCommand[];
	results: RefUpdateResult[];
}): Promise<void> {
	const accepted = new Set(
		input.results.filter((r) => r.ok).map((r) => r.refName),
	);
	const defaultRef = `refs/heads/${input.defaultBranch}`;
	// One entry per commit, however many refs carry it; on-default wins.
	const bySha = new Map<string, PushedCommit & { onDefault: boolean }>();
	for (const update of input.updates) {
		if (
			!accepted.has(update.refName) ||
			!update.refName.startsWith("refs/heads/") ||
			update.newOid === ZERO_OID
		) {
			continue;
		}
		const onDefault = update.refName === defaultRef;
		// A new branch's new commits are those the default branch lacks.
		const exclude =
			update.oldOid !== ZERO_OID
				? update.oldOid
				: onDefault
					? null
					: defaultRef;
		for (const commit of await newCommits(
			input.ownerKey,
			input.repoName,
			update.newOid,
			exclude,
		)) {
			const prev = bySha.get(commit.sha);
			bySha.set(commit.sha, {
				...commit,
				onDefault: onDefault || !!prev?.onDefault,
			});
		}
	}

	const commits = [...bySha.values()];
	const mentions = commits.map((commit) => ({
		commit,
		numbers: getReferencedIssueNumbers(commit.message),
	}));
	const wanted = [...new Set(mentions.flatMap((m) => m.numbers))];
	if (wanted.length === 0) return;

	const [issueRows, prRows] = await Promise.all([
		db
			.select({
				number: issues.number,
				status: issues.status,
				title: issues.title,
			})
			.from(issues)
			.where(
				and(eq(issues.repoId, input.repoId), inArray(issues.number, wanted)),
			),
		db
			.select({ number: pullRequests.number })
			.from(pullRequests)
			.where(
				and(
					eq(pullRequests.repoId, input.repoId),
					inArray(pullRequests.number, wanted),
				),
			),
	]);
	const existing = new Set([...issueRows, ...prRows].map((row) => row.number));
	const openIssues = new Set(
		issueRows.filter((row) => row.status === "open").map((row) => row.number),
	);
	if (existing.size === 0) return;

	// Skip pairs already recorded (the same commit pushed to another branch).
	const shas = [...new Set(commits.map((commit) => commit.sha))];
	const prior = await db
		.select({
			number: timelineEvents.number,
			sha: sql<string>`${timelineEvents.payload}->>'commitSha'`,
		})
		.from(timelineEvents)
		.where(
			and(
				eq(timelineEvents.repoId, input.repoId),
				eq(timelineEvents.event, "referenced"),
				inArray(timelineEvents.number, [...existing]),
				inArray(sql`${timelineEvents.payload}->>'commitSha'`, shas),
			),
		);
	const recorded = new Set(prior.map((row) => `${row.number}:${row.sha}`));

	const rows: (typeof timelineEvents.$inferInsert)[] = [];
	const add = (number: number, event: TimelineEvent) => {
		const { event: type, ...payload } = event;
		rows.push({
			repoId: input.repoId,
			number,
			actorId: input.actorId,
			event: type,
			payload,
		});
	};
	// Oldest commit first, so a thread's events read in commit order.
	const toClose = new Set<number>();
	const closers = new Map<number, string>();
	for (const { commit, numbers } of mentions.reverse()) {
		const message = (commit.message.split("\n")[0] ?? "").slice(
			0,
			MESSAGE_PREVIEW_CHARS,
		);
		for (const number of numbers) {
			if (!existing.has(number)) continue;
			const key = `${number}:${commit.sha}`;
			if (recorded.has(key)) continue;
			recorded.add(key);
			add(number, { event: "referenced", commitSha: commit.sha, message });
		}
		if (!commit.onDefault) continue;
		for (const number of getClosingIssueNumbers(commit.message)) {
			if (!openIssues.has(number) || toClose.has(number)) continue;
			toClose.add(number);
			closers.set(number, commit.sha);
		}
	}
	const closed =
		toClose.size === 0
			? []
			: await db
					.update(issues)
					.set({
						status: "closed",
						closedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(issues.repoId, input.repoId),
							inArray(issues.number, [...toClose]),
							eq(issues.status, "open"),
						),
					)
					.returning({ number: issues.number, title: issues.title });
	for (const { number } of closed) {
		add(number, { event: "closed", commitSha: closers.get(number) });
	}
	if (rows.length > 0) await db.insert(timelineEvents).values(rows);
	// As the manual close path does, so the pusher's feed shows the closing.
	for (const { number, title } of closed) {
		await recordActivity(input.actorId, input.repoId, {
			type: "issue",
			metadata: { number, title, action: "closed" },
		});
	}
}
