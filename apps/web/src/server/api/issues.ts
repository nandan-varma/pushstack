/**
 * GitHub's issues surface at `/api/v3`: list, get, create and update issues.
 * The list returns pull requests too (each carrying a `pull_request` object),
 * exactly as GitHub's does, because issues and pull requests share one `#N`
 * sequence per repository.
 */
import { z } from "zod";
import { labelNameSchema } from "#/lib/labels";
import {
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { replaceThreadAssignees } from "../assignees-store";
import { createIssueForUser, updateIssueThreadFields } from "../issue-store";
import { setThreadLabels } from "../label-store";
import { perfStep } from "../perf-log";
import { findIssueByNumber, findThread, listThreads } from "../thread-store";
import { type ApiContext, requireScope } from "./auth";
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
import { fullNameOf, serializeThread, threadNumber } from "./threads";

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

export async function listIssues(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const filters = issueFilters(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, {});
	// Issues and pull requests together, one query: a merged pull request is
	// `closed` here, as on GitHub.
	const { threads, total } = await perfStep("db: list issues", () =>
		listThreads(
			{
				repoId: repo.id,
				...(filters.state !== "all" && { state: filters.state }),
				...(filters.assignee && { assignees: [filters.assignee] }),
				labels: filters.labels,
			},
			{
				sort: { by: filters.sort, direction: filters.direction },
				limit: params.perPage,
				offset: params.offset,
			},
		),
	);
	const body = threads.map((thread) => serializeThread(repo, thread));
	return json(body, 200, linkHeader(ctx.url, params, total));
}

export async function getIssue(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const thread = await findThread(
		repo.id,
		threadNumber(ctx.params.issue_number),
	);
	if (!thread) throw notFoundError();
	return json(serializeThread(repo, thread, true));
}

const createIssueSchema = z.object({
	title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD).optional(),
	assignees: z
		.array(z.string().trim().min(1).max(100))
		.max(MAX_ASSIGNEES)
		.optional(),
});

const updateIssueSchema = z.object({
	title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS).optional(),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	state: z.enum(["open", "closed"]).optional(),
	state_reason: z.enum(["completed", "not_planned", "reopened"]).nullish(),
	labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD).optional(),
	assignees: z
		.array(z.string().trim().min(1).max(100))
		.max(MAX_ASSIGNEES)
		.optional(),
});

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

export async function createIssue(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
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
		await replaceThreadAssignees(created, data.assignees, caller.userId);
	}
	const thread = await findThread(repo.id, created.number);
	if (!thread) throw new Error("Issue missing after insert");
	return json(serializeThread(repo, thread), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/issues/${created.number}`),
	});
}

export async function updateIssue(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.issue_number);
	const issue = await findIssueByNumber(repo.id, number);
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
	// The state the issue ends in decides which reasons make sense: `reopened`
	// only on an open issue, `completed`/`not_planned` only on a closed one.
	const finalState = data.state ?? issue.status;
	const reason = data.state_reason ?? undefined;
	if (
		reason !== undefined &&
		(reason === "reopened") !== (finalState === "open")
	) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Issue", field: "state_reason", code: "invalid" },
		]);
	}
	await updateIssueThreadFields(issue, caller.userId, {
		...(reason !== undefined &&
			reason !== "reopened" && { stateReason: reason }),
		...(data.title !== undefined && { title: data.title }),
		...(data.body !== undefined && { body: data.body ?? "" }),
		...(data.state !== undefined && { status: data.state }),
	});
	// As on GitHub, a caller without write access can edit their own issue's
	// title, body and state but not its labels or assignees.
	if (access.canWrite) {
		if (data.labels !== undefined) {
			await setThreadLabels(issue, data.labels, caller.userId);
		}
		if (data.assignees !== undefined) {
			await replaceThreadAssignees(issue, data.assignees, caller.userId);
		}
	}
	const thread = await findThread(repo.id, number);
	if (!thread) throw new Error("Issue missing after update");
	return json(serializeThread(repo, thread));
}
