/**
 * Commit statuses and the checks API at `/api/v3`, through which an external
 * CI reports results. GitHub's checks API is for GitHub Apps; here a
 * `repo:write` token of a user with push access creates and updates runs, and
 * a commit has one check suite (no apps).
 */

import { combinedStatusState } from "#/lib/check-rollup";
import {
	type CheckRunFilter,
	type CheckRunInput,
	type CheckRunRow,
	countCommitStatuses,
	countLatestStatuses,
	createCheckRun,
	createCommitStatus,
	DEFAULT_STATUS_CONTEXT,
	ensureCheckSuite,
	findCheckRun,
	findCheckSuite,
	findCommitStatus,
	findSuiteForSha,
	latestCommitStatuses,
	latestRunCounts,
	listCheckRuns,
	listCommitStatuses,
	suiteRuns,
	updateCheckRun,
} from "../check-store";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import type { ApiContext } from "./auth";
import { resolveCommitSha } from "./commit-comments";
import {
	apiUrl,
	json,
	linkHeader,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository, writableRepository } from "./repo-lookup";
import {
	checkRun,
	checkSuite,
	commitStatus,
	minimalRepository,
	simpleCommitStatus,
} from "./serializers";
import { fullNameOf } from "./threads";

// -- commit statuses --------------------------------------------------------

export async function createCommitStatusHandler(ctx: ApiContext) {
	const { repo, caller } = await writableRepository(ctx);
	const { sha: rev } = pathParams(ctx, "repos/create-commit-status");
	const sha = await resolveCommitSha(repo, rev);
	const body = await requestBody(ctx, "repos/create-commit-status", "Status");
	const created = await createCommitStatus({
		repoId: repo.id,
		sha,
		creatorId: caller.userId,
		state: body.state,
		context: body.context ?? DEFAULT_STATUS_CONTEXT,
		targetUrl: body.target_url ?? null,
		description: body.description ?? null,
	});
	if (created === "limit") {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Status",
				code: "custom",
				message:
					"This SHA and context has reached the maximum number of statuses.",
			},
		]);
	}
	const row = await findCommitStatus(repo.id, created.id);
	if (!row) throw new Error("Commit status missing after insert");
	const fullName = fullNameOf(repo);
	return json(commitStatus(fullName, row), 201, {
		Location: apiUrl(`/repos/${fullName}/statuses/${sha}`),
	});
}

export async function listCommitStatusesForRef(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { ref } = pathParams(ctx, "repos/list-commit-statuses-for-ref");
	const sha = await resolveCommitSha(repo, ref);
	const params = pageParams(ctx.url.searchParams);
	const [rows, total] = await Promise.all([
		params.reachable
			? listCommitStatuses(repo.id, sha, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countCommitStatuses(repo.id, sha),
	]);
	const fullName = fullNameOf(repo);
	return json(
		rows.map((row) => commitStatus(fullName, row)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function getCombinedStatusForRef(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { ref } = pathParams(ctx, "repos/get-combined-status-for-ref");
	const sha = await resolveCommitSha(repo, ref);
	const params = pageParams(ctx.url.searchParams);
	const fullName = fullNameOf(repo);
	// The state spans every context; only `statuses` is paged.
	const [all, rows, total] = await Promise.all([
		latestCommitStatuses(repo.id, sha, { limit: 1000 }),
		params.reachable
			? latestCommitStatuses(repo.id, sha, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countLatestStatuses(repo.id, sha),
	]);
	return json(
		{
			state: combinedStatusState(all),
			statuses: rows.map((row) => simpleCommitStatus(fullName, row)),
			sha,
			total_count: total,
			repository: minimalRepository(repo),
			commit_url: apiUrl(`/repos/${fullName}/commits/${sha}`),
			url: apiUrl(`/repos/${fullName}/commits/${sha}/status`),
		},
		200,
		linkHeader(ctx.url, params, total),
	);
}

// -- check runs -------------------------------------------------------------

const unprocessable = (field: string, code: "invalid" | "missing_field") =>
	validationFailedError("Validation Failed", [
		{ resource: "CheckRun", field, code },
	]);

type RunBody = {
	name?: string | undefined;
	external_id?: string | undefined;
	details_url?: string | undefined;
	status?: CheckRunRow["status"] | undefined;
	conclusion?: CheckRunRow["conclusion"] | undefined;
	started_at?: string | undefined;
	completed_at?: string | undefined;
	output?: { title: string; summary: string; text?: string | undefined };
};

/**
 * The run's fields after applying `body` over `current` (GitHub's rules: a
 * conclusion completes the run, a completed run needs one and can't reopen).
 */
function applyRunBody(
	body: RunBody,
	current: Partial<CheckRunInput> & { status: CheckRunInput["status"] },
): Omit<CheckRunInput, "name"> & { name?: string } {
	let status = body.status ?? current.status;
	if (body.conclusion !== undefined) {
		if (body.status !== undefined && body.status !== "completed") {
			throw unprocessable("status", "invalid");
		}
		status = "completed";
	}
	const conclusion =
		status === "completed"
			? (body.conclusion ?? current.conclusion ?? null)
			: null;
	if (status === "completed" && !conclusion) {
		throw unprocessable("conclusion", "missing_field");
	}
	if (current.status === "completed" && status !== "completed") {
		throw unprocessable("status", "invalid");
	}
	const completedAt =
		status === "completed"
			? new Date(body.completed_at ?? current.completedAt ?? Date.now())
			: null;
	return {
		...(body.name !== undefined && { name: body.name }),
		externalId: body.external_id ?? current.externalId ?? null,
		detailsUrl: body.details_url ?? current.detailsUrl ?? null,
		status,
		conclusion,
		startedAt: body.started_at
			? new Date(body.started_at)
			: (current.startedAt ?? null),
		completedAt,
		outputTitle: body.output?.title ?? current.outputTitle ?? null,
		outputSummary: body.output?.summary ?? current.outputSummary ?? null,
		outputText: body.output
			? (body.output.text ?? null)
			: (current.outputText ?? null),
	};
}

export async function createCheckRunHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	pathParams(ctx, "checks/create");
	const body = await requestBody(ctx, "checks/create", "CheckRun");
	const sha = await resolveCommitSha(repo, body.head_sha);
	const fields = applyRunBody(body, { status: body.status ?? "queued" });
	const created = await createCheckRun(repo.id, sha, {
		...fields,
		name: body.name,
	});
	if (created === "limit") {
		throw validationFailedError("Validation Failed", [
			{
				resource: "CheckRun",
				code: "custom",
				message: "This commit has reached the maximum number of check runs.",
			},
		]);
	}
	return json(checkRun(fullNameOf(repo), created), 201);
}

async function requireCheckRun(
	ctx: ApiContext,
	id: "checks/get" | "checks/update",
	repoId: number,
) {
	const { check_run_id } = pathParams(ctx, id);
	const row = await findCheckRun(repoId, check_run_id);
	if (!row) throw notFoundError();
	return row;
}

export async function getCheckRunHandler(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const row = await requireCheckRun(ctx, "checks/get", repo.id);
	return json(checkRun(fullNameOf(repo), row));
}

export async function updateCheckRunHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const row = await requireCheckRun(ctx, "checks/update", repo.id);
	const body = await requestBody(ctx, "checks/update", "CheckRun");
	const { name, ...fields } = applyRunBody(body, row);
	const updated = await updateCheckRun(row, {
		...fields,
		...(name !== undefined && { name }),
	});
	return json(checkRun(fullNameOf(repo), updated));
}

async function runsPage(
	ctx: ApiContext,
	repo: RepositoryRowWithOwner,
	scope: { headSha: string } | { suiteId: number },
	query: CheckRunFilter,
) {
	const params = pageParams(ctx.url.searchParams);
	const { rows, total } = params.reachable
		? await listCheckRuns(repo.id, scope, query, {
				limit: params.perPage,
				offset: params.offset,
			})
		: await listCheckRuns(repo.id, scope, query, { limit: 0 });
	const fullName = fullNameOf(repo);
	return json(
		{
			total_count: total,
			check_runs: rows.map((row) => checkRun(fullName, row)),
		},
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function listCheckRunsForRef(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { ref } = pathParams(ctx, "checks/list-for-ref");
	const sha = await resolveCommitSha(repo, ref);
	const query = queryParams(ctx, "checks/list-for-ref", "CheckRun");
	return runsPage(ctx, repo, { headSha: sha }, query);
}

// -- check suites -----------------------------------------------------------

async function suiteResponse(
	repo: RepositoryRowWithOwner,
	suite: Parameters<typeof checkSuite>[1],
	status = 200,
) {
	const [runs, counts] = await Promise.all([
		suiteRuns(suite.id),
		latestRunCounts([suite.id]),
	]);
	return json(checkSuite(repo, suite, runs, counts.get(suite.id) ?? 0), status);
}

export async function createCheckSuiteHandler(ctx: ApiContext) {
	const { repo } = await writableRepository(ctx);
	const body = await requestBody(ctx, "checks/create-suite", "CheckSuite");
	const sha = await resolveCommitSha(repo, body.head_sha);
	const suite = await ensureCheckSuite(repo.id, sha);
	return suiteResponse(repo, suite, 201);
}

export async function getCheckSuiteHandler(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { check_suite_id } = pathParams(ctx, "checks/get-suite");
	const suite = await findCheckSuite(repo.id, check_suite_id);
	if (!suite) throw notFoundError();
	return suiteResponse(repo, suite);
}

export async function listCheckRunsForSuite(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { check_suite_id } = pathParams(ctx, "checks/list-for-suite");
	const suite = await findCheckSuite(repo.id, check_suite_id);
	if (!suite) throw notFoundError();
	const query = queryParams(ctx, "checks/list-for-suite", "CheckRun");
	return runsPage(ctx, repo, { suiteId: suite.id }, query);
}

export async function listCheckSuitesForRef(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { ref } = pathParams(ctx, "checks/list-suites-for-ref");
	const sha = await resolveCommitSha(repo, ref);
	const suite = await findSuiteForSha(repo.id, sha);
	const rows = suite ? [suite] : [];
	const [runs, counts] = await Promise.all([
		Promise.all(rows.map((suite) => suiteRuns(suite.id))),
		latestRunCounts(rows.map((suite) => suite.id)),
	]);
	return json({
		total_count: rows.length,
		check_suites: rows.map((suite, index) =>
			checkSuite(repo, suite, runs[index] ?? [], counts.get(suite.id) ?? 0),
		),
	});
}
