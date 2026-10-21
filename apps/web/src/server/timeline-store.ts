/**
 * Writing and reading issue/PR timeline events (src/lib/timeline-types.ts).
 * Plain server-only helpers, called from the issue, pull request and comment
 * server functions after their own writes; never a server-function file.
 * Events belong to an issue id (a pull request's is its issue's).
 */
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { db } from "#/db";
import { issues, timelineEvents } from "#/db/app-schema";
import { getReferencedIssueNumbers } from "#/lib/issue-references";
import type {
	ThreadRef,
	TimelineEntry,
	TimelineEvent,
} from "#/lib/timeline-types";
import { publicUserFields } from "./repository-lookup";

function toRow(
	issueId: number,
	actorId: string,
	timelineEvent: TimelineEvent,
	sourceIssueId: number | null = null,
) {
	const { event, ...payload } = timelineEvent;
	return { issueId, actorId, event, payload, sourceIssueId };
}

export async function recordTimelineEvent(
	issueId: number,
	actorId: string,
	event: TimelineEvent,
): Promise<void> {
	await db.insert(timelineEvents).values(toRow(issueId, actorId, event));
}

export async function recordTimelineEvents(
	issueIds: number[],
	actorId: string,
	event: TimelineEvent,
): Promise<void> {
	if (issueIds.length === 0) return;
	await db
		.insert(timelineEvents)
		.values(issueIds.map((issueId) => toRow(issueId, actorId, event)));
}

async function threadIds(
	repoId: number,
	numbers: number[],
	exceptId: number,
): Promise<number[]> {
	if (numbers.length === 0) return [];
	const rows = await db
		.select({ id: issues.id })
		.from(issues)
		.where(
			and(
				eq(issues.repoId, repoId),
				inArray(issues.number, numbers),
				ne(issues.id, exceptId),
			),
		);
	return rows.map((row) => row.id);
}

/**
 * For each `#N` that `text` (a body or comment in thread `source`, issue id
 * `sourceId`) mentions and that exists in the repository, add a "mentioned in
 * #source" event to #N — once per pair, however often it's mentioned again.
 */
export async function recordCrossReferences(
	repoId: number,
	sourceId: number,
	source: ThreadRef,
	text: string | null | undefined,
	actorId: string,
): Promise<void> {
	const targets = await threadIds(
		repoId,
		getReferencedIssueNumbers(text ?? ""),
		sourceId,
	);
	if (targets.length === 0) return;
	await db
		.insert(timelineEvents)
		.values(
			targets.map((issueId) =>
				toRow(
					issueId,
					actorId,
					{ event: "cross-referenced", source },
					sourceId,
				),
			),
		)
		.onConflictDoNothing();
}

/**
 * After text in thread `sourceId` (`#sourceNumber`) was removed (a deleted
 * comment), drop the "mentioned in #source" event from each thread
 * `removedText` mentioned, unless `remainingTexts` (the source's body and
 * other comments) still mention it. Events are one per pair, so they can't be
 * dropped blindly.
 */
export async function removeCrossReferences(
	repoId: number,
	sourceId: number,
	removedText: string,
	remainingTexts: (string | null | undefined)[],
): Promise<void> {
	const stillMentioned = new Set(
		remainingTexts.flatMap((text) => getReferencedIssueNumbers(text ?? "")),
	);
	const dropped = await threadIds(
		repoId,
		getReferencedIssueNumbers(removedText).filter(
			(number) => !stillMentioned.has(number),
		),
		sourceId,
	);
	if (dropped.length === 0) return;
	await db
		.delete(timelineEvents)
		.where(
			and(
				eq(timelineEvents.event, "cross-referenced"),
				eq(timelineEvents.sourceIssueId, sourceId),
				inArray(timelineEvents.issueId, dropped),
			),
		);
}

/**
 * Which events a listing covers: all of them (the timeline), or the issue
 * events only — GitHub's issue-events API leaves reviews out.
 */
export type TimelineScope = "timeline" | "issue-events";

const scopeFilter = (scope: TimelineScope) =>
	scope === "issue-events" ? { event: { ne: "reviewed" as const } } : {};

export async function listTimeline(
	issueId: number,
	options?: { limit?: number; offset?: number; scope?: TimelineScope },
): Promise<TimelineEntry[]> {
	const rows = await db.query.timelineEvents.findMany({
		where: { issueId, ...scopeFilter(options?.scope ?? "timeline") },
		orderBy: { createdAt: "asc", id: "asc" },
		with: { actor: publicUserFields },
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
	});
	return rows.map(
		(row) =>
			({
				...row.payload,
				event: row.event,
				id: row.id,
				createdAt: row.createdAt,
				actor: row.actor,
			}) as TimelineEntry,
	);
}

export async function countTimeline(
	issueId: number,
	scope: TimelineScope = "timeline",
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(timelineEvents)
		.where(
			scope === "issue-events"
				? and(
						eq(timelineEvents.issueId, issueId),
						ne(timelineEvents.event, "reviewed"),
					)
				: eq(timelineEvents.issueId, issueId),
		);
	return row?.total ?? 0;
}
