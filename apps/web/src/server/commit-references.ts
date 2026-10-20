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
import { issues, timelineEvents } from "#/db/app-schema";
import {
	getClosingIssueNumbers,
	getReferencedIssueNumbers,
} from "#/lib/issue-references";
import type { TimelineEvent } from "#/lib/timeline-types";
import { recordActivity } from "./activity";
import { getCommitLog } from "./git-read";

export const MAX_PUSH_COMMITS = 100;
const ZERO_OID = "0".repeat(40);
const MESSAGE_PREVIEW_CHARS = 200;

interface PushedCommit {
	sha: string;
	message: string;
}

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

	const threads = await db
		.select({
			id: issues.id,
			number: issues.number,
			isPullRequest: issues.isPullRequest,
			status: issues.status,
		})
		.from(issues)
		.where(
			and(eq(issues.repoId, input.repoId), inArray(issues.number, wanted)),
		);
	const existing = new Map(threads.map((row) => [row.number, row.id]));
	const openIssues = new Set(
		threads
			.filter((row) => !row.isPullRequest && row.status === "open")
			.map((row) => row.number),
	);
	if (existing.size === 0) return;

	// Skip pairs already recorded (the same commit pushed to another branch).
	const shas = [...new Set(commits.map((commit) => commit.sha))];
	const prior = await db
		.select({
			issueId: timelineEvents.issueId,
			sha: sql<string>`${timelineEvents.payload}->>'commitSha'`,
		})
		.from(timelineEvents)
		.where(
			and(
				eq(timelineEvents.event, "referenced"),
				inArray(timelineEvents.issueId, [...existing.values()]),
				inArray(sql`${timelineEvents.payload}->>'commitSha'`, shas),
			),
		);
	const recorded = new Set(prior.map((row) => `${row.issueId}:${row.sha}`));

	const rows: (typeof timelineEvents.$inferInsert)[] = [];
	const add = (issueId: number, event: TimelineEvent) => {
		const { event: type, ...payload } = event;
		rows.push({ issueId, actorId: input.actorId, event: type, payload });
	};
	const toClose = new Set<number>();
	const closers = new Map<number, string>();
	for (const { commit, numbers } of mentions.reverse()) {
		const message = (commit.message.split("\n")[0] ?? "").slice(
			0,
			MESSAGE_PREVIEW_CHARS,
		);
		for (const number of numbers) {
			const issueId = existing.get(number);
			if (issueId === undefined) continue;
			const key = `${issueId}:${commit.sha}`;
			if (recorded.has(key)) continue;
			recorded.add(key);
			add(issueId, { event: "referenced", commitSha: commit.sha, message });
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
						stateReason: "completed",
						closedAt: new Date(),
						closedById: input.actorId,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(issues.repoId, input.repoId),
							inArray(issues.number, [...toClose]),
							eq(issues.status, "open"),
						),
					)
					.returning({
						id: issues.id,
						number: issues.number,
						title: issues.title,
					});
	for (const { id, number } of closed) {
		add(id, {
			event: "closed",
			commitSha: closers.get(number),
			stateReason: "completed",
		});
	}
	if (rows.length > 0) await db.insert(timelineEvents).values(rows);
	for (const { number, title } of closed) {
		await recordActivity(input.actorId, input.repoId, {
			type: "issue",
			metadata: { number, title, action: "closed" },
		});
	}
}
