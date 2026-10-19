/**
 * Writing and reading issue/PR timeline events (src/lib/timeline-types.ts).
 * Plain server-only helpers, called from the issue, pull request and comment
 * server functions after their own writes; never a server-function file.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { issues, pullRequests, timelineEvents } from "#/db/app-schema";
import { getReferencedIssueNumbers } from "#/lib/issue-references";
import type {
	ThreadRef,
	TimelineEntry,
	TimelineEvent,
} from "#/lib/timeline-types";
import { publicUserFields } from "./repository-lookup";

function toRow(
	repoId: number,
	number: number,
	actorId: string,
	timelineEvent: TimelineEvent,
) {
	const { event, ...payload } = timelineEvent;
	return {
		repoId,
		number,
		actorId,
		event,
		payload,
		sourceNumber:
			timelineEvent.event === "cross-referenced"
				? timelineEvent.source.number
				: null,
	};
}

/** Record one event on thread `#number` of `repoId`. */
export async function recordTimelineEvent(
	repoId: number,
	number: number,
	actorId: string,
	event: TimelineEvent,
): Promise<void> {
	await db.insert(timelineEvents).values(toRow(repoId, number, actorId, event));
}

/** Record the same event on several threads (e.g. every issue a merge closes). */
export async function recordTimelineEvents(
	repoId: number,
	numbers: number[],
	actorId: string,
	event: TimelineEvent,
): Promise<void> {
	if (numbers.length === 0) return;
	await db
		.insert(timelineEvents)
		.values(numbers.map((number) => toRow(repoId, number, actorId, event)));
}

/**
 * For each `#N` that `text` (a body or comment in thread `source`) mentions
 * and that exists in the repository, add a "mentioned in #source" event to
 * #N — once per pair, however often it's mentioned again.
 */
export async function recordCrossReferences(
	repoId: number,
	source: ThreadRef,
	text: string | null | undefined,
	actorId: string,
): Promise<void> {
	const mentioned = getReferencedIssueNumbers(text ?? "").filter(
		(number) => number !== source.number,
	);
	if (mentioned.length === 0) return;
	const [issueRows, prRows] = await Promise.all([
		db
			.select({ number: issues.number })
			.from(issues)
			.where(and(eq(issues.repoId, repoId), inArray(issues.number, mentioned))),
		db
			.select({ number: pullRequests.number })
			.from(pullRequests)
			.where(
				and(
					eq(pullRequests.repoId, repoId),
					inArray(pullRequests.number, mentioned),
				),
			),
	]);
	const targets = [...issueRows, ...prRows].map((row) => row.number);
	if (targets.length === 0) return;
	await db
		.insert(timelineEvents)
		.values(
			targets.map((number) =>
				toRow(repoId, number, actorId, { event: "cross-referenced", source }),
			),
		)
		.onConflictDoNothing();
}

/** Thread `#number`'s events, oldest first. */
export async function listTimeline(
	repoId: number,
	number: number,
): Promise<TimelineEntry[]> {
	const rows = await db.query.timelineEvents.findMany({
		where: and(
			eq(timelineEvents.repoId, repoId),
			eq(timelineEvents.number, number),
		),
		orderBy: [asc(timelineEvents.createdAt), asc(timelineEvents.id)],
		with: { actor: publicUserFields },
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
