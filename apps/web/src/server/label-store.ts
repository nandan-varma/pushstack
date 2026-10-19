/**
 * Repository labels: storage helpers shared by the label server functions,
 * the issue/PR server functions and repository creation. Plain server-only
 * module (see repository-lookup.ts for why this is not a server-function file).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import { labels, threadLabels } from "#/db/app-schema";
import { DEFAULT_LABELS, type LabelView } from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import { recordTimelineEvent } from "./timeline-store";

const labelColumns = {
	id: labels.id,
	name: labels.name,
	color: labels.color,
	description: labels.description,
};

/** GitHub's default label set, for a repository that was just created. */
export async function createDefaultLabels(repoId: number): Promise<void> {
	await db
		.insert(labels)
		.values(DEFAULT_LABELS.map((label) => ({ repoId, ...label })))
		.onConflictDoNothing();
}

/** A repository's labels, by name. */
export function listLabels(repoId: number): Promise<LabelView[]> {
	return db
		.select(labelColumns)
		.from(labels)
		.where(eq(labels.repoId, repoId))
		.orderBy(asc(sql`lower(${labels.name})`));
}

/** The labels on each of threads `numbers`, in one query. */
export async function labelsByThread(
	repoId: number,
	numbers: number[],
): Promise<Map<number, LabelView[]>> {
	const byThread = new Map<number, LabelView[]>();
	if (numbers.length === 0) return byThread;
	const rows = await db
		.select({ number: threadLabels.number, ...labelColumns })
		.from(threadLabels)
		.innerJoin(labels, eq(labels.id, threadLabels.labelId))
		.where(
			and(
				eq(threadLabels.repoId, repoId),
				inArray(threadLabels.number, numbers),
			),
		)
		.orderBy(asc(sql`lower(${labels.name})`));
	for (const { number, ...label } of rows) {
		const list = byThread.get(number);
		if (list) list.push(label);
		else byThread.set(number, [label]);
	}
	return byThread;
}

/** Add `labels: LabelView[]` to each row of a list. */
export async function withLabels<T extends { number: number }>(
	repoId: number,
	rows: T[],
): Promise<(T & { labels: LabelView[] })[]> {
	const byThread = await labelsByThread(
		repoId,
		rows.map((row) => row.number),
	);
	return rows.map((row) => ({
		...row,
		labels: byThread.get(row.number) ?? [],
	}));
}

/**
 * A `number IN (…)` subquery of the threads carrying every one of `names`
 * (GitHub's `label:a label:b` is an AND), names matched ignoring case.
 */
export function threadsWithLabels(repoId: number, names: string[]) {
	const wanted = [...new Set(names.map((name) => name.toLowerCase()))];
	return db
		.select({ number: threadLabels.number })
		.from(threadLabels)
		.innerJoin(labels, eq(labels.id, threadLabels.labelId))
		.where(
			and(
				eq(threadLabels.repoId, repoId),
				inArray(sql`lower(${labels.name})`, wanted),
			),
		)
		.groupBy(threadLabels.number)
		.having(sql`count(distinct ${labels.id}) = ${wanted.length}`);
}

/**
 * Make thread `#number` carry exactly the labels named `names`, recording
 * `labeled`/`unlabeled` events for the difference. Unknown names throw.
 * The caller has checked write access and that the thread exists.
 */
export async function setThreadLabels(
	repoId: number,
	number: number,
	names: string[],
	actorId: string,
): Promise<LabelView[]> {
	const wanted = [...new Set(names.map((name) => name.toLowerCase()))];
	if (wanted.length > MAX_LABELS_PER_THREAD) {
		throw new Error(`At most ${MAX_LABELS_PER_THREAD} labels per thread`);
	}
	const chosen =
		wanted.length === 0
			? []
			: await db
					.select(labelColumns)
					.from(labels)
					.where(
						and(
							eq(labels.repoId, repoId),
							inArray(sql`lower(${labels.name})`, wanted),
						),
					);
	const known = new Set(chosen.map((label) => label.name.toLowerCase()));
	const unknown = wanted.filter((name) => !known.has(name));
	if (unknown.length > 0) {
		throw new Error(`Unknown label: ${unknown.join(", ")}`);
	}

	const current = (await labelsByThread(repoId, [number])).get(number) ?? [];
	const currentIds = new Set(current.map((label) => label.id));
	const chosenIds = new Set(chosen.map((label) => label.id));
	const added = chosen.filter((label) => !currentIds.has(label.id));
	const removed = current.filter((label) => !chosenIds.has(label.id));

	if (added.length > 0) {
		await db
			.insert(threadLabels)
			.values(added.map((label) => ({ repoId, number, labelId: label.id })))
			.onConflictDoNothing();
	}
	if (removed.length > 0) {
		await db.delete(threadLabels).where(
			and(
				eq(threadLabels.repoId, repoId),
				eq(threadLabels.number, number),
				inArray(
					threadLabels.labelId,
					removed.map((label) => label.id),
				),
			),
		);
	}
	for (const label of added) {
		await recordTimelineEvent(repoId, number, actorId, {
			event: "labeled",
			label: { name: label.name, color: label.color },
		});
	}
	for (const label of removed) {
		await recordTimelineEvent(repoId, number, actorId, {
			event: "unlabeled",
			label: { name: label.name, color: label.color },
		});
	}
	return chosen.sort((a, b) => a.name.localeCompare(b.name));
}
