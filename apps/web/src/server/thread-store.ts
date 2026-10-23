/**
 * Issues and pull requests, GitHub's model: every thread is an `issues` row
 * (one `#N` sequence per repository), and a pull request adds a
 * `pull_requests` row keyed by the issue id. This module is the one place
 * threads are read: `listThreads` serves every list (the web issue and pull
 * request lists and the REST `issues` and `pulls` lists) as one indexed query
 * per page that also carries each row's author, labels, assignees and comment
 * count. Plain server-only module (see repository-lookup.ts for why this is
 * not a server-function file).
 */
import {
	type AnyColumn,
	and,
	asc,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
	comments,
	type Issue,
	issues,
	labels,
	pullRequestReviewRequests,
	pullRequestReviews,
	pullRequests,
	threadAssignees,
	threadLabels,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import type { LabelView } from "#/lib/labels";
import { containing } from "./db-filters";
import { type PublicUser, publicUserColumns } from "./repository-lookup";

export type ThreadKind = "issue" | "pull_request";

export interface ThreadRef {
	kind: ThreadKind;
	/** The issue id (a pull request's too: it is an issue). */
	id: number;
	repoId: number;
	number: number;
	title: string;
	body: string | null;
}

export type PullRequestFields = Omit<
	typeof pullRequests.$inferSelect,
	"issueId"
>;

/**
 * A pull request as one record: its issue's columns plus its own, with
 * `status` `merged` once merged (the issue itself is then `closed`).
 */
export type PullRequest = Omit<Issue, "status"> &
	PullRequestFields & { status: "open" | "closed" | "merged" };

export interface Thread extends Issue {
	kind: ThreadKind;
	author: PublicUser;
	closedBy: PublicUser | null;
	labels: LabelView[];
	assignees: PublicUser[];
	/** Pending review requests (a pull request's; always empty for an issue). */
	requestedReviewers: PublicUser[];
	commentsCount: number;
	/** Null for an issue. */
	pullRequest: (PullRequestFields & { mergedByUser: PublicUser | null }) | null;
}

export interface ThreadFilter {
	repoId: number;
	/** One kind, or both (the REST issues list). */
	kind?: ThreadKind;
	/** The issue state; omitted for all. */
	state?: "open" | "closed";
	/** Pull requests only: merged (true) or closed without merging (false). */
	merged?: boolean;
	numbers?: number[];
	/** Title or body contains every term. */
	terms?: string[];
	/** Authored by every one of these usernames. */
	authors?: string[];
	/** Mentions every one of these usernames (title, body or a comment). */
	mentions?: string[];
	/** Carries every one of these labels (names, ignoring case). */
	labels?: string[];
	noLabel?: boolean;
	/** Each a username, `none` (unassigned) or `*` (assigned to anyone); ANDed. */
	assignees?: string[];
	/** A pending review request for every one of these usernames; ANDed. */
	reviewRequested?: string[];
	/** A submitted review by every one of these usernames; ANDed. */
	reviewedBy?: string[];
	/** Head branch; `null` matches nothing (a head from another owner). */
	head?: string | null;
	base?: string;
}

export interface ThreadSort {
	by: "created" | "updated" | "comments";
	direction: "asc" | "desc";
	/** The direction ties (equal keys) fall back to by `#N`; default `direction`. */
	tiebreak?: "asc" | "desc";
}

const DEFAULT_SORT: ThreadSort = { by: "created", direction: "desc" };

/** A json value as the driver returns it (parsed, or text on some drivers). */
const json = <T>(value: unknown): T =>
	(typeof value === "string" ? JSON.parse(value) : value) as T;

const userJson = (id: AnyColumn) => sql`json_build_object(
	'id', ${user.id}, 'apiId', ${user.apiId}, 'username', ${user.username},
	'name', ${user.name}, 'image', ${user.image}) from ${user} where ${user.id} = ${id}`;

const commentCount = sql<number>`(select count(*)::int from ${comments} where ${comments.issueId} = ${issues.id})`;

const threadColumns = {
	issue: issues,
	pr: pullRequests,
	author: publicUserColumns,
	labels: sql`coalesce((select json_agg(json_build_object(
		'id', ${labels.id}, 'name', ${labels.name}, 'color', ${labels.color},
		'description', ${labels.description}) order by lower(${labels.name}))
		from ${threadLabels} inner join ${labels} on ${labels.id} = ${threadLabels.labelId}
		where ${threadLabels.issueId} = ${issues.id}), '[]'::json)`.mapWith(
		json<LabelView[]>,
	),
	assignees: sql`coalesce((select json_agg(json_build_object(
		'id', ${user.id}, 'apiId', ${user.apiId}, 'username', ${user.username},
		'name', ${user.name}, 'image', ${user.image}) order by ${threadAssignees.id})
		from ${threadAssignees} inner join ${user} on ${user.id} = ${threadAssignees.userId}
		where ${threadAssignees.issueId} = ${issues.id}), '[]'::json)`.mapWith(
		json<PublicUser[]>,
	),
	requestedReviewers: sql`coalesce((select json_agg(json_build_object(
		'id', ${user.id}, 'apiId', ${user.apiId}, 'username', ${user.username},
		'name', ${user.name}, 'image', ${user.image}) order by ${pullRequestReviewRequests.id})
		from ${pullRequestReviewRequests} inner join ${user} on ${user.id} = ${pullRequestReviewRequests.userId}
		where ${pullRequestReviewRequests.issueId} = ${issues.id}), '[]'::json)`.mapWith(
		json<PublicUser[]>,
	),
	closedBy: sql`(select ${userJson(issues.closedById)})`.mapWith(
		json<PublicUser | null>,
	),
	mergedBy: sql`(select ${userJson(pullRequests.mergedBy)})`.mapWith(
		json<PublicUser | null>,
	),
	commentsCount: commentCount.mapWith(Number),
	total: sql<number>`count(*) over ()`.mapWith(Number),
};

const mentionPattern = (username: string) =>
	`@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`;

/** One assignee filter value: a username, `none` or `*`. */
function assigneeCondition(assignee: string): SQL {
	const rows = db
		.select({ one: sql`1` })
		.from(threadAssignees)
		.where(eq(threadAssignees.issueId, issues.id));
	if (assignee === "*") return exists(rows);
	if (assignee === "none") return notExists(rows);
	return exists(
		db
			.select({ one: sql`1` })
			.from(threadAssignees)
			.innerJoin(user, eq(user.id, threadAssignees.userId))
			.where(
				and(
					eq(threadAssignees.issueId, issues.id),
					eq(user.username, assignee),
				),
			),
	);
}

/** Issue ids carrying every one of `names` (GitHub's `label:a label:b` is an AND). */
function issuesWithLabels(repoId: number, names: string[]) {
	const wanted = [...new Set(names.map((name) => name.toLowerCase()))];
	return db
		.select({ issueId: threadLabels.issueId })
		.from(threadLabels)
		.innerJoin(labels, eq(labels.id, threadLabels.labelId))
		.where(
			and(
				eq(labels.repoId, repoId),
				inArray(sql`lower(${labels.name})`, wanted),
			),
		)
		.groupBy(threadLabels.issueId)
		.having(sql`count(distinct ${labels.id}) = ${wanted.length}`);
}

function whereOf(filter: ThreadFilter): SQL | undefined {
	const conditions: (SQL | undefined)[] = [eq(issues.repoId, filter.repoId)];
	const add = (condition: SQL | undefined) => conditions.push(condition);
	if (filter.kind) {
		add(eq(issues.isPullRequest, filter.kind === "pull_request"));
	}
	if (filter.state) add(eq(issues.status, filter.state));
	if (filter.merged !== undefined) {
		add(
			filter.merged
				? isNotNull(pullRequests.mergedAt)
				: isNull(pullRequests.mergedAt),
		);
	}
	if (filter.numbers) add(inArray(issues.number, filter.numbers));
	for (const term of filter.terms ?? []) {
		add(
			or(
				ilike(issues.title, containing(term)),
				ilike(issues.body, containing(term)),
			),
		);
	}
	for (const username of filter.authors ?? []) {
		add(
			inArray(
				issues.authorId,
				db
					.select({ id: user.id })
					.from(user)
					.where(eq(user.username, username)),
			),
		);
	}
	for (const username of filter.mentions ?? []) {
		const pattern = mentionPattern(username);
		add(
			or(
				sql`${issues.title} ~* ${pattern}`,
				sql`${issues.body} ~* ${pattern}`,
				exists(
					db
						.select({ one: sql`1` })
						.from(comments)
						.where(
							and(
								eq(comments.issueId, issues.id),
								sql`${comments.body} ~* ${pattern}`,
							),
						),
				),
			),
		);
	}
	if (filter.noLabel) {
		add(
			notExists(
				db
					.select({ one: sql`1` })
					.from(threadLabels)
					.where(eq(threadLabels.issueId, issues.id)),
			),
		);
	} else if (filter.labels && filter.labels.length > 0) {
		add(inArray(issues.id, issuesWithLabels(filter.repoId, filter.labels)));
	}
	for (const assignee of filter.assignees ?? []) {
		add(assigneeCondition(assignee));
	}
	for (const username of filter.reviewRequested ?? []) {
		add(
			exists(
				db
					.select({ one: sql`1` })
					.from(pullRequestReviewRequests)
					.innerJoin(user, eq(user.id, pullRequestReviewRequests.userId))
					.where(
						and(
							eq(pullRequestReviewRequests.issueId, issues.id),
							eq(user.username, username),
						),
					),
			),
		);
	}
	for (const username of filter.reviewedBy ?? []) {
		add(
			exists(
				db
					.select({ one: sql`1` })
					.from(pullRequestReviews)
					.innerJoin(user, eq(user.id, pullRequestReviews.authorId))
					.where(
						and(
							eq(pullRequestReviews.pullRequestId, issues.id),
							ne(pullRequestReviews.state, "pending"),
							eq(user.username, username),
						),
					),
			),
		);
	}
	if (filter.head === null) add(sql`false`);
	else if (filter.head) add(eq(pullRequests.sourceBranch, filter.head));
	if (filter.base) add(eq(pullRequests.targetBranch, filter.base));
	return and(...conditions);
}

function orderOf(sort: ThreadSort): SQL[] {
	const order = sort.direction === "asc" ? asc : desc;
	const tie = (sort.tiebreak ?? sort.direction) === "asc" ? asc : desc;
	const key =
		sort.by === "updated"
			? issues.updatedAt
			: sort.by === "comments"
				? commentCount
				: issues.createdAt;
	return [order(key), tie(issues.number)];
}

interface ThreadRecord {
	issue: Issue;
	pr: typeof pullRequests.$inferSelect | null;
	author: PublicUser;
	labels: LabelView[];
	assignees: PublicUser[];
	requestedReviewers: PublicUser[];
	closedBy: PublicUser | null;
	mergedBy: PublicUser | null;
	commentsCount: number;
	total: number;
}

function toThread(record: ThreadRecord): Thread {
	let pullRequest: Thread["pullRequest"] = null;
	if (record.pr) {
		const { issueId: _, ...fields } = record.pr;
		pullRequest = { ...fields, mergedByUser: record.mergedBy };
	}
	return {
		...record.issue,
		kind: record.issue.isPullRequest ? "pull_request" : "issue",
		author: record.author,
		closedBy: record.closedBy,
		labels: record.labels,
		assignees: record.assignees,
		requestedReviewers: record.requestedReviewers,
		commentsCount: record.commentsCount,
		pullRequest,
	};
}

/**
 * One page of threads and the total matching `filter`, in one query: the
 * total is a window count, so a second (count) query runs only when the page
 * is past the end.
 */
export async function listThreads(
	filter: ThreadFilter,
	options: { sort?: ThreadSort; limit: number; offset?: number },
): Promise<{ threads: Thread[]; total: number }> {
	const where = whereOf(filter);
	const records = (await db
		.select(threadColumns)
		.from(issues)
		.innerJoin(user, eq(user.id, issues.authorId))
		.leftJoin(pullRequests, eq(pullRequests.issueId, issues.id))
		.where(where)
		.orderBy(...orderOf(options.sort ?? DEFAULT_SORT))
		.limit(options.limit)
		.offset(options.offset ?? 0)) as ThreadRecord[];
	const first = records[0];
	if (first) return { threads: records.map(toThread), total: first.total };
	if (!options.offset) return { threads: [], total: 0 };
	const [row] = await db
		.select({ total: sql<number>`count(*)::int`.mapWith(Number) })
		.from(issues)
		.leftJoin(pullRequests, eq(pullRequests.issueId, issues.id))
		.where(where);
	return { threads: [], total: row?.total ?? 0 };
}

export async function findThreads(
	repoId: number,
	numbers: number[],
	kind?: ThreadKind,
): Promise<Thread[]> {
	if (numbers.length === 0) return [];
	const unique = [...new Set(numbers)];
	const { threads } = await listThreads(
		{ repoId, numbers: unique, kind },
		{ limit: unique.length },
	);
	return threads;
}

export async function findThread(
	repoId: number,
	number: number,
	kind?: ThreadKind,
): Promise<Thread | null> {
	return (await findThreads(repoId, [number], kind))[0] ?? null;
}

/** A thread as one pull request record (`status` `merged` once merged). */
export function pullRequestOf(
	issue: Issue,
	fields: PullRequestFields,
): PullRequest {
	return {
		...issue,
		...fields,
		status: fields.mergedAt ? "merged" : issue.status,
	};
}

export function pullRequestOfThread(thread: Thread): PullRequest {
	if (!thread.pullRequest) throw new Error(`#${thread.number} is an issue`);
	const { mergedByUser: _, ...fields } = thread.pullRequest;
	const {
		kind: _kind,
		author: _author,
		closedBy: _closedBy,
		labels: _labels,
		assignees: _assignees,
		requestedReviewers: _requestedReviewers,
		commentsCount: _comments,
		pullRequest: _pr,
		...issue
	} = thread;
	return pullRequestOf(issue, fields);
}

export function issueView(thread: Thread) {
	const {
		kind: _,
		pullRequest: _pr,
		requestedReviewers: _requested,
		assignees,
		...issue
	} = thread;
	return { ...issue, assignees: assignees.map((user) => ({ user })) };
}

export function pullRequestView(thread: Thread) {
	return {
		...pullRequestOfThread(thread),
		author: thread.author,
		closedBy: thread.closedBy,
		labels: thread.labels,
		commentsCount: thread.commentsCount,
		assignees: thread.assignees.map((user) => ({ user })),
		requestedReviewers: thread.requestedReviewers,
	};
}

const refColumns = {
	id: issues.id,
	repoId: issues.repoId,
	number: issues.number,
	title: issues.title,
	body: issues.body,
	isPullRequest: issues.isPullRequest,
};

function toRef({
	isPullRequest,
	...row
}: {
	isPullRequest: boolean;
	id: number;
	repoId: number;
	number: number;
	title: string;
	body: string | null;
}): ThreadRef {
	return { kind: isPullRequest ? "pull_request" : "issue", ...row };
}

export async function findThreadById(id: number): Promise<ThreadRef | null> {
	const [row] = await db
		.select(refColumns)
		.from(issues)
		.where(eq(issues.id, id))
		.limit(1);
	return row ? toRef(row) : null;
}

export async function findThreadByNumber(
	repoId: number,
	number: number,
): Promise<ThreadRef | null> {
	const [row] = await db
		.select(refColumns)
		.from(issues)
		.where(and(eq(issues.repoId, repoId), eq(issues.number, number)))
		.limit(1);
	return row ? toRef(row) : null;
}

export async function findPullRequestById(
	id: number,
): Promise<PullRequest | null> {
	const [row] = await db
		.select({ issue: issues, pr: pullRequests })
		.from(issues)
		.innerJoin(pullRequests, eq(pullRequests.issueId, issues.id))
		.where(eq(issues.id, id))
		.limit(1);
	if (!row) return null;
	const { issueId: _, ...fields } = row.pr;
	return pullRequestOf(row.issue, fields);
}

export async function findIssueById(id: number): Promise<Issue | null> {
	const [row] = await db
		.select()
		.from(issues)
		.where(and(eq(issues.id, id), eq(issues.isPullRequest, false)))
		.limit(1);
	return row ?? null;
}

export async function findIssueByNumber(
	repoId: number,
	number: number,
): Promise<Issue | null> {
	const [row] = await db
		.select()
		.from(issues)
		.where(
			and(
				eq(issues.repoId, repoId),
				eq(issues.number, number),
				eq(issues.isPullRequest, false),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function findPullRequestByNumber(
	repoId: number,
	number: number,
): Promise<PullRequest | null> {
	const [row] = await db
		.select({ issue: issues, pr: pullRequests })
		.from(issues)
		.innerJoin(pullRequests, eq(pullRequests.issueId, issues.id))
		.where(and(eq(issues.repoId, repoId), eq(issues.number, number)))
		.limit(1);
	if (!row) return null;
	const { issueId: _, ...fields } = row.pr;
	return pullRequestOf(row.issue, fields);
}
