/**
 * Commit statuses and check runs that external CI reports (GitHub's statuses
 * and checks APIs), shared by the REST API and the web UI's server functions.
 * Plain server-only module: callers turn the returned reasons into errors.
 *
 * Statuses are append-only; a context's current status is its newest row.
 * A commit has at most one check suite (there are no GitHub Apps), created on
 * the first run.
 */
import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "#/db";
import { checkRuns, checkSuites, commitStatuses } from "#/db/app-schema";
import {
	type CheckRunState,
	rollupState,
	type StatusState,
} from "#/lib/check-rollup";
import {
	MAX_CHECK_RUNS_PER_COMMIT,
	MAX_STATUSES_PER_CONTEXT,
} from "#/lib/limits";
import { isUniqueViolation } from "./db-errors";
import { publicUserFields } from "./repository-lookup";

export type CommitStatusRow = typeof commitStatuses.$inferSelect;
export type CheckRunRow = typeof checkRuns.$inferSelect;
export type CheckSuiteRow = typeof checkSuites.$inferSelect;

interface Page {
	limit?: number;
	offset?: number;
}

export const DEFAULT_STATUS_CONTEXT = "default";

/** Records a status; `limit` when the commit and context hold the maximum. */
export async function createCommitStatus(input: {
	repoId: number;
	sha: string;
	creatorId: string;
	state: StatusState;
	context: string;
	targetUrl: string | null;
	description: string | null;
}): Promise<{ id: number } | "limit"> {
	const [existing] = await db
		.select({ total: count() })
		.from(commitStatuses)
		.where(
			and(
				eq(commitStatuses.repoId, input.repoId),
				eq(commitStatuses.sha, input.sha),
				eq(commitStatuses.context, input.context),
			),
		);
	if ((existing?.total ?? 0) >= MAX_STATUSES_PER_CONTEXT) return "limit";
	const [row] = await db
		.insert(commitStatuses)
		.values(input)
		.returning({ id: commitStatuses.id });
	if (!row) throw new Error("Commit status missing after insert");
	return row;
}

export function findCommitStatus(repoId: number, id: number) {
	return db.query.commitStatuses.findFirst({
		where: { id, repoId },
		with: { creator: publicUserFields },
	});
}

/** Every status of a commit, newest first. */
export function listCommitStatuses(repoId: number, sha: string, page?: Page) {
	return db.query.commitStatuses.findMany({
		where: { repoId, sha },
		with: { creator: publicUserFields },
		orderBy: (table) => [desc(table.id)],
		...(page?.limit !== undefined && { limit: page.limit }),
		...(page?.offset !== undefined && { offset: page.offset }),
	});
}

export async function countCommitStatuses(repoId: number, sha: string) {
	const [row] = await db
		.select({ total: count() })
		.from(commitStatuses)
		.where(and(eq(commitStatuses.repoId, repoId), eq(commitStatuses.sha, sha)));
	return row?.total ?? 0;
}

/** The newest row id of each context among `shas`' statuses. */
function latestStatusIds(repoId: number, shas: string[]) {
	return db
		.select({ id: max(commitStatuses.id) })
		.from(commitStatuses)
		.where(
			and(eq(commitStatuses.repoId, repoId), inArray(commitStatuses.sha, shas)),
		)
		.groupBy(commitStatuses.sha, commitStatuses.context);
}

/** A commit's current status per context, ordered by context. */
export async function latestCommitStatuses(
	repoId: number,
	sha: string,
	page?: Page,
) {
	const ids = await db
		.select({ id: commitStatuses.id })
		.from(commitStatuses)
		.where(
			and(
				eq(commitStatuses.repoId, repoId),
				inArray(commitStatuses.id, latestStatusIds(repoId, [sha])),
			),
		)
		.orderBy(commitStatuses.context)
		.limit(page?.limit ?? 100)
		.offset(page?.offset ?? 0);
	if (ids.length === 0) return [];
	const rows = await db.query.commitStatuses.findMany({
		where: { repoId, id: { in: ids.map((row) => row.id) } },
		with: { creator: publicUserFields },
	});
	const byId = new Map(rows.map((row) => [row.id, row]));
	return ids.flatMap(({ id }) => byId.get(id) ?? []);
}

/** Number of contexts a commit has statuses for. */
export async function countLatestStatuses(repoId: number, sha: string) {
	const [row] = await db
		.select({ total: sql<number>`count(distinct ${commitStatuses.context})` })
		.from(commitStatuses)
		.where(and(eq(commitStatuses.repoId, repoId), eq(commitStatuses.sha, sha)));
	return Number(row?.total ?? 0);
}

// -- check runs and suites --------------------------------------------------

/** The commit's suite, created when absent. */
export async function ensureCheckSuite(
	repoId: number,
	headSha: string,
	headBranch?: string | null,
): Promise<CheckSuiteRow> {
	const find = () =>
		db.query.checkSuites.findFirst({ where: { repoId, headSha } });
	const existing = await find();
	if (existing) return existing;
	try {
		await db
			.insert(checkSuites)
			.values({ repoId, headSha, headBranch: headBranch ?? null });
	} catch (error) {
		if (!isUniqueViolation(error)) throw error;
	}
	const created = await find();
	if (!created) throw new Error("Check suite missing after insert");
	return created;
}

export function findCheckSuite(repoId: number, id: number) {
	return db.query.checkSuites.findFirst({ where: { id, repoId } });
}

export function findSuiteForSha(repoId: number, headSha: string) {
	return db.query.checkSuites.findFirst({ where: { repoId, headSha } });
}

/** Bumps a suite's `updated_at` after one of its runs changed. */
export async function touchCheckSuite(id: number) {
	await db
		.update(checkSuites)
		.set({ updatedAt: new Date() })
		.where(eq(checkSuites.id, id));
}

export interface CheckRunInput {
	name: string;
	externalId: string | null;
	detailsUrl: string | null;
	status: CheckRunRow["status"];
	conclusion: CheckRunRow["conclusion"];
	startedAt: Date | null;
	completedAt: Date | null;
	outputTitle: string | null;
	outputSummary: string | null;
	outputText: string | null;
}

/** Creates a run on the commit's suite; `limit` when the commit holds the maximum. */
export async function createCheckRun(
	repoId: number,
	headSha: string,
	input: CheckRunInput,
): Promise<CheckRunRow | "limit"> {
	const [existing] = await db
		.select({ total: count() })
		.from(checkRuns)
		.where(and(eq(checkRuns.repoId, repoId), eq(checkRuns.headSha, headSha)));
	if ((existing?.total ?? 0) >= MAX_CHECK_RUNS_PER_COMMIT) return "limit";
	const suite = await ensureCheckSuite(repoId, headSha);
	const [row] = await db
		.insert(checkRuns)
		.values({ ...input, repoId, headSha, suiteId: suite.id })
		.returning();
	if (!row) throw new Error("Check run missing after insert");
	await touchCheckSuite(suite.id);
	return row;
}

export function findCheckRun(repoId: number, id: number) {
	return db.query.checkRuns.findFirst({ where: { id, repoId } });
}

export async function updateCheckRun(
	run: CheckRunRow,
	changes: Partial<CheckRunInput>,
): Promise<CheckRunRow> {
	const [row] = await db
		.update(checkRuns)
		.set({ ...changes, updatedAt: new Date() })
		.where(eq(checkRuns.id, run.id))
		.returning();
	if (!row) throw new Error("Check run missing after update");
	await touchCheckSuite(run.suiteId);
	return row;
}

export interface CheckRunFilter {
	check_name?: string | undefined;
	status?: CheckRunRow["status"] | undefined;
	/** `latest` keeps the newest run of each name; `all` every run. */
	filter?: "latest" | "all" | undefined;
}

function runWhere(
	scope: { headSha: string } | { suiteId: number },
	repoId: number,
	filter: CheckRunFilter,
) {
	const latest = (filter.filter ?? "latest") === "latest";
	return and(
		eq(checkRuns.repoId, repoId),
		"suiteId" in scope
			? eq(checkRuns.suiteId, scope.suiteId)
			: eq(checkRuns.headSha, scope.headSha),
		filter.check_name === undefined
			? undefined
			: eq(checkRuns.name, filter.check_name),
		latest
			? inArray(
					checkRuns.id,
					db
						.select({ id: max(checkRuns.id) })
						.from(checkRuns)
						.where(
							and(
								eq(checkRuns.repoId, repoId),
								"suiteId" in scope
									? eq(checkRuns.suiteId, scope.suiteId)
									: eq(checkRuns.headSha, scope.headSha),
							),
						)
						.groupBy(checkRuns.name),
				)
			: undefined,
		filter.status === undefined
			? undefined
			: eq(checkRuns.status, filter.status),
	);
}

/** Runs of a commit or suite, newest first, and the total before paging. */
export async function listCheckRuns(
	repoId: number,
	scope: { headSha: string } | { suiteId: number },
	filter: CheckRunFilter,
	page?: Page,
) {
	const where = runWhere(scope, repoId, filter);
	const [rows, [total]] = await Promise.all([
		db
			.select()
			.from(checkRuns)
			.where(where)
			.orderBy(desc(checkRuns.id))
			.limit(page?.limit ?? 100)
			.offset(page?.offset ?? 0),
		db.select({ total: count() }).from(checkRuns).where(where),
	]);
	return { rows, total: total?.total ?? 0 };
}

/** Every run of a suite (for its computed status), bounded by the per-commit cap. */
export function suiteRuns(suiteId: number) {
	return db
		.select({ status: checkRuns.status, conclusion: checkRuns.conclusion })
		.from(checkRuns)
		.where(eq(checkRuns.suiteId, suiteId));
}

/** How many runs each suite holds (latest per name), keyed by suite id. */
export async function latestRunCounts(
	suiteIds: number[],
): Promise<Map<number, number>> {
	if (suiteIds.length === 0) return new Map();
	const rows = await db
		.select({
			suiteId: checkRuns.suiteId,
			total: sql<number>`count(distinct ${checkRuns.name})`,
		})
		.from(checkRuns)
		.where(inArray(checkRuns.suiteId, suiteIds))
		.groupBy(checkRuns.suiteId);
	return new Map(rows.map((row) => [row.suiteId, Number(row.total)]));
}

/** The newest run of each name on `shas`, for the UI's rollups. */
async function latestRunsForShas(repoId: number, shas: string[]) {
	return db
		.select({
			sha: checkRuns.headSha,
			status: checkRuns.status,
			conclusion: checkRuns.conclusion,
		})
		.from(checkRuns)
		.where(
			and(
				eq(checkRuns.repoId, repoId),
				inArray(
					checkRuns.id,
					db
						.select({ id: max(checkRuns.id) })
						.from(checkRuns)
						.where(
							and(
								eq(checkRuns.repoId, repoId),
								inArray(checkRuns.headSha, shas),
							),
						)
						.groupBy(checkRuns.headSha, checkRuns.name),
				),
			),
		);
}

/** `rollupState` of each of `shas` that has any report (absent = none). */
export async function commitRollups(
	repoId: number,
	shas: string[],
): Promise<Map<string, "success" | "failure" | "pending">> {
	const unique = [...new Set(shas)];
	if (unique.length === 0) return new Map();
	const [statuses, runs] = await Promise.all([
		db
			.select({ sha: commitStatuses.sha, state: commitStatuses.state })
			.from(commitStatuses)
			.where(
				and(
					eq(commitStatuses.repoId, repoId),
					inArray(commitStatuses.id, latestStatusIds(repoId, unique)),
				),
			),
		latestRunsForShas(repoId, unique),
	]);
	const bySha = new Map<
		string,
		{ statuses: { state: StatusState }[]; runs: CheckRunState[] }
	>();
	const entry = (sha: string) => {
		const value = bySha.get(sha) ?? { statuses: [], runs: [] };
		bySha.set(sha, value);
		return value;
	};
	for (const row of statuses) entry(row.sha).statuses.push(row);
	for (const row of runs) entry(row.sha).runs.push(row);
	const result = new Map<string, "success" | "failure" | "pending">();
	for (const [sha, value] of bySha) {
		const state = rollupState(value.statuses, value.runs);
		if (state) result.set(sha, state);
	}
	return result;
}
