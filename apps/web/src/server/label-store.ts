import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import { labels, threadLabels } from "#/db/app-schema";
import { DEFAULT_LABELS, type LabelView } from "#/lib/labels";
import { MAX_LABELS_PER_REPOSITORY, MAX_LABELS_PER_THREAD } from "#/lib/limits";
import { bestEffort } from "./best-effort";
import { isUniqueViolation } from "./db-errors";
import { assertRepositoryCapacity } from "./repository-capacity";
import { recordTimelineEvent } from "./timeline-store";

export class DuplicateLabelError extends Error {
	constructor() {
		super("A label with this name already exists");
	}
}

export class UnknownLabelError extends Error {
	constructor(readonly names: string[]) {
		super(`Unknown label: ${names.join(", ")}`);
	}
}

const labelColumns = {
	id: labels.id,
	name: labels.name,
	color: labels.color,
	description: labels.description,
};

/**
 * Create a label; a duplicate name (ignoring case) is a `DuplicateLabelError`,
 * and a repository at `MAX_LABELS_PER_REPOSITORY` refuses with a
 * `RepositoryCapacityError`.
 */
export async function createRepoLabel(
	repoId: number,
	data: { name: string; color: string; description?: string },
): Promise<LabelView> {
	const [held] = await db
		.select({ total: count() })
		.from(labels)
		.where(eq(labels.repoId, repoId));
	assertRepositoryCapacity(
		Number(held?.total ?? 0),
		MAX_LABELS_PER_REPOSITORY,
		`A repository holds at most ${MAX_LABELS_PER_REPOSITORY} labels`,
	);
	const [label] = await db
		.insert(labels)
		.values({
			repoId,
			name: data.name,
			color: data.color,
			description: data.description || null,
		})
		.returning()
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateLabelError() : error;
		});
	if (!label) throw new Error("Label insert returned no row");
	return label;
}

/** A repository's label by name, ignoring case. */
export async function findLabelByName(
	repoId: number,
	name: string,
): Promise<LabelView | null> {
	const [row] = await db
		.select(labelColumns)
		.from(labels)
		.where(
			and(
				eq(labels.repoId, repoId),
				eq(sql`lower(${labels.name})`, name.toLowerCase()),
			),
		);
	return row ?? null;
}

/** Rename or recolor; threads keep the label (they reference it by id). */
export async function updateRepoLabelById(
	repoId: number,
	labelId: number,
	fields: { name?: string; color?: string; description?: string },
): Promise<LabelView | null> {
	const changes = {
		...(fields.name !== undefined && { name: fields.name }),
		...(fields.color !== undefined && { color: fields.color }),
		...(fields.description !== undefined && {
			description: fields.description || null,
		}),
	};
	if (Object.keys(changes).length === 0) {
		const [existing] = await db
			.select(labelColumns)
			.from(labels)
			.where(and(eq(labels.id, labelId), eq(labels.repoId, repoId)));
		return existing ?? null;
	}
	const [label] = await db
		.update(labels)
		.set(changes)
		.where(and(eq(labels.id, labelId), eq(labels.repoId, repoId)))
		.returning()
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateLabelError() : error;
		});
	return label ?? null;
}

export async function deleteRepoLabelById(
	repoId: number,
	labelId: number,
): Promise<boolean> {
	const deleted = await db
		.delete(labels)
		.where(and(eq(labels.id, labelId), eq(labels.repoId, repoId)))
		.returning({ id: labels.id });
	return deleted.length > 0;
}

export async function createDefaultLabels(repoId: number): Promise<void> {
	await db
		.insert(labels)
		.values(DEFAULT_LABELS.map((label) => ({ repoId, ...label })))
		.onConflictDoNothing();
}

export function listLabels(repoId: number): Promise<LabelView[]> {
	return db
		.select(labelColumns)
		.from(labels)
		.where(eq(labels.repoId, repoId))
		.orderBy(asc(sql`lower(${labels.name})`), asc(labels.id));
}

export async function countLabels(repoId: number): Promise<number> {
	const [held] = await db
		.select({ total: count() })
		.from(labels)
		.where(eq(labels.repoId, repoId));
	return Number(held?.total ?? 0);
}

/** One page of a repository's labels by name, with the total the Link header needs. */
export async function listLabelsPage(
	repoId: number,
	page: { limit: number; offset: number },
): Promise<{ labels: LabelView[]; total: number }> {
	const where = eq(labels.repoId, repoId);
	const [rows, [held]] = await Promise.all([
		db
			.select(labelColumns)
			.from(labels)
			.where(where)
			.orderBy(asc(sql`lower(${labels.name})`), asc(labels.id))
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(labels).where(where),
	]);
	return { labels: rows, total: Number(held?.total ?? 0) };
}

export function labelsOfThread(issueId: number): Promise<LabelView[]> {
	return db
		.select(labelColumns)
		.from(threadLabels)
		.innerJoin(labels, eq(labels.id, threadLabels.labelId))
		.where(eq(threadLabels.issueId, issueId))
		.orderBy(asc(sql`lower(${labels.name})`));
}

/**
 * Make `thread` (an issue or pull request) carry exactly the labels named
 * `names`, recording `labeled`/`unlabeled` events for the difference. Unknown
 * names throw. The caller has checked write access and that the thread exists.
 */
export async function setThreadLabels(
	thread: { id: number; repoId: number },
	names: string[],
	actorId: string,
): Promise<LabelView[]> {
	const { id: issueId, repoId } = thread;
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
		throw new UnknownLabelError(unknown);
	}

	const current = await labelsOfThread(issueId);
	const currentIds = new Set(current.map((label) => label.id));
	const chosenIds = new Set(chosen.map((label) => label.id));
	const added = chosen.filter((label) => !currentIds.has(label.id));
	const removed = current.filter((label) => !chosenIds.has(label.id));

	if (added.length > 0) {
		await db
			.insert(threadLabels)
			.values(added.map((label) => ({ issueId, labelId: label.id })))
			.onConflictDoNothing();
	}
	if (removed.length > 0) {
		await db.delete(threadLabels).where(
			and(
				eq(threadLabels.issueId, issueId),
				inArray(
					threadLabels.labelId,
					removed.map((label) => label.id),
				),
			),
		);
	}
	// The label rows are committed above. Each event is best-effort on its own,
	// so one failed event neither fails the change nor drops the others.
	const events = [
		...added.map((label) => ({ event: "labeled" as const, label })),
		...removed.map((label) => ({ event: "unlabeled" as const, label })),
	];
	for (const { event, label } of events) {
		await bestEffort(
			"label-store",
			`The ${event} event of label ${label.name}`,
			() =>
				recordTimelineEvent(issueId, actorId, {
					event,
					label: { name: label.name, color: label.color },
				}),
		);
	}
	return chosen.sort((a, b) => a.name.localeCompare(b.name));
}
