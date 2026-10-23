/**
 * Milestones: a repository's `milestones` rows and the one milestone an issue
 * or pull request may carry (`issues.milestone_id`). Plain server-only module
 * shared by the web server functions and the REST API. Every milestone read
 * carries its open and closed counts (issues and pull requests together, as on
 * GitHub); a merged pull request counts as closed.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "#/db";
import { issues, milestones, repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { isUniqueViolation } from "./db-errors";
import type { PublicUser } from "./repository-lookup";
import { recordTimelineEvent } from "./timeline-store";

export interface MilestoneView {
	id: number;
	/** The repo-scoped milestone number (its own sequence, not the issue `#N`). */
	number: number;
	title: string;
	description: string | null;
	state: "open" | "closed";
	dueOn: Date | null;
	createdAt: Date;
	updatedAt: Date;
	closedAt: Date | null;
	creator: PublicUser | null;
	openIssues: number;
	closedIssues: number;
}

export class DuplicateMilestoneError extends Error {
	constructor() {
		super("A milestone with this title already exists");
	}
}

/** The milestone number named does not exist in the repository. */
export class UnknownMilestoneError extends Error {
	constructor() {
		super("Unknown milestone");
	}
}

const json = <T>(value: unknown): T =>
	(typeof value === "string" ? JSON.parse(value) : value) as T;

const userObject = sql`json_build_object(
	'id', ${user.id}, 'apiId', ${user.apiId}, 'username', ${user.username},
	'name', ${user.name}, 'image', ${user.image})`;

// Written out with the table name: drizzle leaves columns unqualified in a
// single-table select, where `milestones.id` would read as `ms_issues.id`.
const openCount = sql`(select count(*)::int from issues ms_issues
	where ms_issues.milestone_id = "milestones"."id" and ms_issues.status = 'open')`;
const closedCount = sql`(select count(*)::int from issues ms_issues
	where ms_issues.milestone_id = "milestones"."id" and ms_issues.status = 'closed')`;

const creatorJson = sql`(select ${userObject} from ${user}
	where ${user.id} = "milestones"."creator_id")`;

const milestoneColumns = {
	id: milestones.id,
	number: milestones.number,
	title: milestones.title,
	description: milestones.description,
	state: milestones.state,
	dueOn: milestones.dueOn,
	createdAt: milestones.createdAt,
	updatedAt: milestones.updatedAt,
	closedAt: milestones.closedAt,
	creator: creatorJson.mapWith(json<PublicUser | null>),
	openIssues: openCount.mapWith(Number),
	closedIssues: closedCount.mapWith(Number),
};

interface MilestoneJson
	extends Omit<
		MilestoneView,
		"dueOn" | "createdAt" | "updatedAt" | "closedAt"
	> {
	dueOn: string | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
}

const date = (value: string | null) => (value ? new Date(value) : null);

/**
 * The milestone of `issues.milestone_id` as one json value, for the thread
 * queries (one round trip per page); `null` when the thread has none.
 */
export const threadMilestoneJson = sql`(select json_build_object(
	'id', ${milestones.id}, 'number', ${milestones.number},
	'title', ${milestones.title}, 'description', ${milestones.description},
	'state', ${milestones.state}, 'dueOn', ${milestones.dueOn},
	'createdAt', ${milestones.createdAt}, 'updatedAt', ${milestones.updatedAt},
	'closedAt', ${milestones.closedAt}, 'creator', ${creatorJson},
	'openIssues', ${openCount}, 'closedIssues', ${closedCount})
	from ${milestones} where ${milestones.id} = ${issues.milestoneId})`.mapWith(
	(value): MilestoneView | null => {
		const raw = json<MilestoneJson | null>(value);
		if (!raw) return null;
		return {
			...raw,
			dueOn: date(raw.dueOn),
			createdAt: new Date(raw.createdAt),
			updatedAt: new Date(raw.updatedAt),
			closedAt: date(raw.closedAt),
		};
	},
);

export interface MilestoneListOptions {
	state: "open" | "closed" | "all";
	sort: "due_on" | "completeness";
	direction: "asc" | "desc";
	limit: number;
	offset?: number;
}

export async function listMilestones(
	repoId: number,
	options: MilestoneListOptions,
): Promise<{ milestones: MilestoneView[]; total: number }> {
	const order = options.direction === "asc" ? asc : desc;
	const share = sql`case when ${openCount} + ${closedCount} = 0 then 0
		else ${closedCount}::float / (${openCount} + ${closedCount}) end`;
	const key =
		options.sort === "completeness"
			? order(share)
			: sql`${milestones.dueOn} ${sql.raw(options.direction)} nulls last`;
	const where = and(
		eq(milestones.repoId, repoId),
		options.state === "all" ? undefined : eq(milestones.state, options.state),
	);
	const rows = await db
		.select({
			...milestoneColumns,
			total: sql<number>`count(*) over ()`.mapWith(Number),
		})
		.from(milestones)
		.where(where)
		.orderBy(key, asc(milestones.number))
		.limit(options.limit)
		.offset(options.offset ?? 0);
	const first = rows[0];
	if (first) {
		return {
			milestones: rows.map(({ total: _, ...view }) => view),
			total: first.total,
		};
	}
	if (!options.offset) return { milestones: [], total: 0 };
	const [row] = await db
		.select({ total: sql<number>`count(*)::int`.mapWith(Number) })
		.from(milestones)
		.where(where);
	return { milestones: [], total: row?.total ?? 0 };
}

export async function findMilestoneByNumber(
	repoId: number,
	number: number,
): Promise<MilestoneView | null> {
	const [row] = await db
		.select(milestoneColumns)
		.from(milestones)
		.where(and(eq(milestones.repoId, repoId), eq(milestones.number, number)))
		.limit(1);
	return row ?? null;
}

/** Open and closed milestone counts, for the list's tabs. */
export async function countMilestones(
	repoId: number,
): Promise<{ open: number; closed: number }> {
	const rows = await db
		.select({
			state: milestones.state,
			total: sql<number>`count(*)::int`.mapWith(Number),
		})
		.from(milestones)
		.where(eq(milestones.repoId, repoId))
		.groupBy(milestones.state);
	const count = (state: "open" | "closed") =>
		rows.find((row) => row.state === state)?.total ?? 0;
	return { open: count("open"), closed: count("closed") };
}

export async function createMilestone(
	repoId: number,
	creatorId: string,
	data: {
		title: string;
		description?: string | null;
		dueOn?: Date | null;
		state?: "open" | "closed";
	},
): Promise<MilestoneView> {
	// Checked before claiming a number so a rejected duplicate leaves no gap
	// (the unique index still decides a race).
	const [taken] = await db
		.select({ id: milestones.id })
		.from(milestones)
		.where(
			and(
				eq(milestones.repoId, repoId),
				eq(sql`lower(${milestones.title})`, data.title.toLowerCase()),
			),
		)
		.limit(1);
	if (taken) throw new DuplicateMilestoneError();
	const [counter] = await db
		.update(repositories)
		.set({
			nextMilestoneNumber: sql`${repositories.nextMilestoneNumber} + 1`,
		})
		.where(eq(repositories.id, repoId))
		.returning({ next: repositories.nextMilestoneNumber });
	if (!counter) throw new Error("Repository not found");
	const state = data.state ?? "open";
	const [row] = await db
		.insert(milestones)
		.values({
			repoId,
			number: counter.next - 1,
			title: data.title,
			description: data.description || null,
			dueOn: data.dueOn ?? null,
			state,
			creatorId,
			closedAt: state === "closed" ? new Date() : null,
		})
		.returning({ number: milestones.number })
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateMilestoneError() : error;
		});
	const view = row && (await findMilestoneByNumber(repoId, row.number));
	if (!view) throw new Error("Milestone insert returned no row");
	return view;
}

/** Edit a milestone; `null` when `number` names none. */
export async function updateMilestone(
	repoId: number,
	number: number,
	fields: {
		title?: string;
		description?: string | null;
		dueOn?: Date | null;
		state?: "open" | "closed";
	},
): Promise<MilestoneView | null> {
	const current = await findMilestoneByNumber(repoId, number);
	if (!current) return null;
	const now = new Date();
	const stateChanged =
		fields.state !== undefined && fields.state !== current.state;
	await db
		.update(milestones)
		.set({
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.description !== undefined && {
				description: fields.description || null,
			}),
			...(fields.dueOn !== undefined && { dueOn: fields.dueOn }),
			...(stateChanged && {
				state: fields.state,
				closedAt: fields.state === "closed" ? now : null,
			}),
			updatedAt: now,
		})
		.where(eq(milestones.id, current.id))
		.catch((error: unknown) => {
			throw isUniqueViolation(error) ? new DuplicateMilestoneError() : error;
		});
	return findMilestoneByNumber(repoId, number);
}

/** Delete a milestone (its issues and pull requests lose it); false when missing. */
export async function deleteMilestone(
	repoId: number,
	number: number,
): Promise<boolean> {
	const rows = await db
		.delete(milestones)
		.where(and(eq(milestones.repoId, repoId), eq(milestones.number, number)))
		.returning({ id: milestones.id });
	return rows.length > 0;
}

/**
 * Put issue or pull request `thread` in milestone `number` of its repository
 * (`null` clears it). An unknown number is an `UnknownMilestoneError`. A change
 * records `demilestoned` (the old one) and `milestoned` (the new one) by
 * `actorId`, as GitHub does.
 */
export async function setThreadMilestone(
	thread: { id: number; repoId: number },
	number: number | null,
	actorId: string,
): Promise<void> {
	const target =
		number === null
			? null
			: ((
					await db
						.select({ id: milestones.id, title: milestones.title })
						.from(milestones)
						.where(
							and(
								eq(milestones.repoId, thread.repoId),
								eq(milestones.number, number),
							),
						)
				)[0] ?? null);
	if (number !== null && !target) throw new UnknownMilestoneError();
	const [current] = await db
		.select({ id: milestones.id, title: milestones.title })
		.from(issues)
		.leftJoin(milestones, eq(milestones.id, issues.milestoneId))
		.where(eq(issues.id, thread.id));
	const previous =
		current?.id && current.title
			? { id: current.id, title: current.title }
			: null;
	if ((previous?.id ?? null) === (target?.id ?? null)) return;
	await db
		.update(issues)
		.set({ milestoneId: target?.id ?? null, updatedAt: new Date() })
		.where(eq(issues.id, thread.id));
	if (previous) {
		await recordTimelineEvent(thread.id, actorId, {
			event: "demilestoned",
			milestone: { title: previous.title },
		});
	}
	if (target) {
		await recordTimelineEvent(thread.id, actorId, {
			event: "milestoned",
			milestone: { title: target.title },
		});
	}
}
