/**
 * GitHub's issues surface at `/api/v3`: list, get, create and update issues.
 * The list returns pull requests too (each carrying a `pull_request` object),
 * exactly as GitHub's does, because issues and pull requests share one `#N`
 * sequence per repository.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments, issues, pullRequests } from "#/db/app-schema";
import { user } from "#/db/schema";
import { labelNameSchema } from "#/lib/labels";
import {
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LABELS_PER_THREAD,
} from "#/lib/limits";
import { replaceIssueAssignees } from "../assignees-store";
import {
	assigneeCondition,
	createIssueForUser,
	updateIssueThreadFields,
} from "../issue-store";
import { setThreadLabels, threadsWithLabels } from "../label-store";
import { perfStep } from "../perf-log";
import { publicUserColumns } from "../repository-lookup";
import { commentCountsByNumbers } from "../thread-store";
import { type ApiContext, requireCaller } from "./auth";
import {
	apiUrl,
	type FieldError,
	forbiddenError,
	json,
	linkHeader,
	notFoundError,
	pageParams,
	readJsonObject,
	validationFailedError,
} from "./http";
import { readableRepository } from "./repo-lookup";
import {
	findThreadRowsByNumber,
	fullNameOf,
	loadThreadMeta,
	serializeThread,
	type ThreadRow,
	threadNumber,
} from "./threads";

const stateSchema = z.enum(["open", "closed", "all"]);
const sortSchema = z.enum(["created", "updated", "comments"]).catch("created");
const directionSchema = z.enum(["asc", "desc"]).catch("desc");

interface IssueFilters {
	state: "open" | "closed" | "all";
	assignee?: string;
	labels: string[];
	sort: "created" | "updated" | "comments";
	direction: "asc" | "desc";
}

/** `state`, `labels`, `assignee`, `sort` and `direction`, GitHub's defaults. */
function issueFilters(query: URLSearchParams): IssueFilters {
	// An invalid state is 422 (GitHub's rule); sort and direction fall back.
	const rawState = query.get("state") ?? "open";
	const state = stateSchema.safeParse(rawState);
	if (!state.success) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Issue", field: "state", code: "invalid", value: rawState },
		]);
	}
	return {
		state: state.data,
		// A login, `none` (unassigned) or `*` (assigned to anyone).
		assignee: query.get("assignee")?.slice(0, 100) || undefined,
		labels: (query.get("labels") ?? "")
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean)
			.slice(0, MAX_LABELS_PER_THREAD),
		sort: sortSchema.parse(query.get("sort") ?? undefined),
		direction: directionSchema.parse(query.get("direction") ?? undefined),
	};
}

/**
 * The column a page is ordered by. `comments` needs a correlated count, and is
 * supported so `sort=comments` behaves as on GitHub.
 */
function sortColumn(
	kind: "issue" | "pull_request",
	sort: IssueFilters["sort"],
) {
	if (sort === "created")
		return kind === "issue" ? issues.createdAt : pullRequests.createdAt;
	if (sort === "updated")
		return kind === "issue" ? issues.updatedAt : pullRequests.updatedAt;
	return kind === "issue"
		? sql`(select count(*) from ${comments} where ${comments.issueId} = ${issues.id})`
		: sql`(select count(*) from ${comments} where ${comments.pullRequestId} = ${pullRequests.id})`;
}

const issueColumns = { row: issues, author: publicUserColumns };
const pullRequestColumns = { row: pullRequests, author: publicUserColumns };

/** `GET /repos/{owner}/{repo}/issues` */
export async function listIssues(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const filters = issueFilters(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, {});

	const issueWhere = and(
		eq(issues.repoId, repo.id),
		filters.state === "all" ? undefined : eq(issues.status, filters.state),
		filters.assignee ? assigneeCondition(filters.assignee, issues) : undefined,
		filters.labels.length > 0
			? inArray(issues.number, threadsWithLabels(repo.id, filters.labels))
			: undefined,
	);
	// A merged pull request is closed for the issues surface; pull requests have
	// no assignees here, so an assignee filter only matches `none`.
	const pullRequestStatuses =
		filters.state === "open"
			? (["open"] as const)
			: filters.state === "closed"
				? (["closed", "merged"] as const)
				: null;
	const pullRequestWhere = and(
		eq(pullRequests.repoId, repo.id),
		pullRequestStatuses
			? inArray(pullRequests.status, [...pullRequestStatuses])
			: undefined,
		filters.assignee && filters.assignee !== "none" ? sql`false` : undefined,
		filters.labels.length > 0
			? inArray(pullRequests.number, threadsWithLabels(repo.id, filters.labels))
			: undefined,
	);

	// Each source is capped at the deepest row this page can need; merging the
	// two ordered lists then yields the page without loading everything.
	const cap = params.offset + params.perPage;
	const [issueRows, pullRequestRows, [issueTotal], [pullRequestTotal]] =
		await perfStep("db: list issues", () =>
			Promise.all([
				db
					.select(issueColumns)
					.from(issues)
					.innerJoin(user, eq(user.id, issues.authorId))
					.where(issueWhere)
					.orderBy(
						filters.direction === "asc"
							? asc(sortColumn("issue", filters.sort))
							: desc(sortColumn("issue", filters.sort)),
						filters.direction === "asc"
							? asc(issues.number)
							: desc(issues.number),
					)
					.limit(cap),
				db
					.select(pullRequestColumns)
					.from(pullRequests)
					.innerJoin(user, eq(user.id, pullRequests.authorId))
					.where(pullRequestWhere)
					.orderBy(
						filters.direction === "asc"
							? asc(sortColumn("pull_request", filters.sort))
							: desc(sortColumn("pull_request", filters.sort)),
						filters.direction === "asc"
							? asc(pullRequests.number)
							: desc(pullRequests.number),
					)
					.limit(cap),
				db.select({ total: count() }).from(issues).where(issueWhere),
				db
					.select({ total: count() })
					.from(pullRequests)
					.where(pullRequestWhere),
			]),
		);

	const rows: ThreadRow[] = [
		...issueRows.map(({ row, author }) => ({
			kind: "issue" as const,
			id: row.id,
			number: row.number,
			title: row.title,
			body: row.body,
			state: row.status,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			closedAt: row.closedAt,
			mergedAt: null,
			author,
		})),
		...pullRequestRows.map(({ row, author }) => ({
			kind: "pull_request" as const,
			id: row.id,
			number: row.number,
			title: row.title,
			body: row.body,
			state: row.status === "open" ? ("open" as const) : ("closed" as const),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			closedAt: row.status === "open" ? null : (row.mergedAt ?? row.updatedAt),
			mergedAt: row.mergedAt,
			author,
		})),
	];
	const page = await paginateRows(repo.id, rows, filters, params);
	const meta = await loadThreadMeta(repo.id, page);
	const body = page.map((row) => serializeThread(repo, row, meta));
	const total = (issueTotal?.total ?? 0) + (pullRequestTotal?.total ?? 0);
	return json(body, 200, linkHeader(ctx.url, params, total));
}

/** Sort the merged rows, then take the requested page. */
async function paginateRows(
	repoId: number,
	rows: ThreadRow[],
	filters: IssueFilters,
	params: ReturnType<typeof pageParams>,
): Promise<ThreadRow[]> {
	const counts =
		filters.sort === "comments"
			? await commentCountsByNumbers(
					repoId,
					rows.map((row) => row.number),
				)
			: undefined;
	const direction = filters.direction === "asc" ? 1 : -1;
	const key = (row: ThreadRow) =>
		filters.sort === "created"
			? row.createdAt.getTime()
			: filters.sort === "updated"
				? row.updatedAt.getTime()
				: (counts?.get(row.number) ?? 0);
	rows.sort(
		(a, b) =>
			(key(a) - key(b)) * direction || (a.number - b.number) * direction,
	);
	return rows.slice(params.offset, params.offset + params.perPage);
}

/** `GET /repos/{owner}/{repo}/issues/{number}` */
export async function getIssue(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.number);
	const [row] = await findThreadRowsByNumber(repo.id, [number]);
	if (!row) throw notFoundError();
	const meta = await loadThreadMeta(repo.id, [row]);
	return json(serializeThread(repo, row, meta));
}

const createIssueSchema = z.object({
	title: z.string().trim().min(1).max(256),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD).optional(),
	assignees: z
		.array(z.string().trim().min(1).max(100))
		.max(MAX_ASSIGNEES)
		.optional(),
});

const updateIssueSchema = z.object({
	title: z.string().trim().min(1).max(256).optional(),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	state: z.enum(["open", "closed"]).optional(),
	labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD).optional(),
	assignees: z
		.array(z.string().trim().min(1).max(100))
		.max(MAX_ASSIGNEES)
		.optional(),
});

/** GitHub's `errors[]` for a failed issue body parse. */
function issueErrors(
	error: z.ZodError,
	body: Record<string, unknown>,
): FieldError[] {
	return error.issues.map((issue) => {
		const field = String(issue.path[0] ?? "");
		return {
			resource: "Issue",
			field,
			code: body[field] === undefined ? "missing_field" : "invalid",
		};
	});
}

/** `POST /repos/{owner}/{repo}/issues` */
export async function createIssue(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You can't open issues in this repository");
	}
	const body = await readJsonObject(ctx.request);
	const parsed = createIssueSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			issueErrors(parsed.error, body),
		);
	}
	// Labels and assignees are triage: a participant without write access opens
	// the issue unlabeled and unassigned, as on GitHub.
	const data = parsed.data;
	const created = await createIssueForUser(repo.id, caller.userId, {
		title: data.title,
		body: data.body ?? undefined,
		labels: access.canWrite ? (data.labels ?? []) : [],
	});
	if (access.canWrite && data.assignees && data.assignees.length > 0) {
		await replaceIssueAssignees(
			{ id: created.id, repoId: repo.id, number: created.number },
			data.assignees,
			caller.userId,
		);
	}
	const [row] = await findThreadRowsByNumber(repo.id, [created.number]);
	if (!row) throw new Error("Issue missing after insert");
	const meta = await loadThreadMeta(repo.id, [row]);
	return json(serializeThread(repo, row, meta), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/issues/${created.number}`),
	});
}

/** `PATCH /repos/{owner}/{repo}/issues/{number}` */
export async function updateIssue(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { repo, access } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.number);
	const issue = await db.query.issues.findFirst({
		where: { repoId: repo.id, number },
	});
	// Pull request numbers are readable through the issues endpoints but not
	// editable through them; editing a pull request uses the pulls endpoints.
	if (!issue) throw notFoundError();
	if (issue.authorId !== caller.userId && !access.canWrite) {
		throw forbiddenError("You do not have permission to edit this issue");
	}
	const body = await readJsonObject(ctx.request);
	const parsed = updateIssueSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			issueErrors(parsed.error, body),
		);
	}
	const data = parsed.data;
	await updateIssueThreadFields(issue, caller.userId, {
		...(data.title !== undefined && { title: data.title }),
		...(data.body !== undefined && { body: data.body ?? "" }),
		...(data.state !== undefined && { status: data.state }),
	});
	// As on GitHub, a caller without write access can edit their own issue's
	// title, body and state but not its labels or assignees.
	if (access.canWrite) {
		if (data.labels !== undefined) {
			await setThreadLabels(repo.id, number, data.labels, caller.userId);
		}
		if (data.assignees !== undefined) {
			await replaceIssueAssignees(
				{ id: issue.id, repoId: repo.id, number },
				data.assignees,
				caller.userId,
			);
		}
	}
	const [row] = await findThreadRowsByNumber(repo.id, [number]);
	if (!row) throw new Error("Issue missing after update");
	const meta = await loadThreadMeta(repo.id, [row]);
	return json(serializeThread(repo, row, meta));
}
