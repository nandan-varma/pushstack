/**
 * GitHub's issues surface at `/api/v3`: list, get, create and update issues.
 * The list returns pull requests too (each carrying a `pull_request` object),
 * exactly as GitHub's does, because issues and pull requests share one `#N`
 * sequence per repository. Inputs are parsed with the contract's schemas
 * (`./input`).
 */
import { replaceThreadAssignees } from "../assignees-store";
import { createIssueForUser, updateIssueThreadFields } from "../issue-store";
import { setThreadLabels } from "../label-store";
import {
	findMilestoneByNumber,
	setThreadMilestone,
	UnknownMilestoneError,
} from "../milestone-store";
import { perfStep } from "../perf-log";
import { updatePullRequestFields } from "../pull-request-store";
import { findThread, listThreads, pullRequestOfThread } from "../thread-store";
import { type ApiContext, requireScope } from "./auth";
import {
	apiUrl,
	forbiddenError,
	json,
	linkHeader,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { fullNameOf, serializeThread, serializeThreads } from "./threads";

const invalidMilestoneError = () =>
	validationFailedError("Validation Failed", [
		{ resource: "Issue", field: "milestone", code: "invalid" },
	]);

/** Set `milestone` (a number, or `null` to clear), mapping an unknown one to 422. */
async function applyMilestone(
	thread: { id: number; repoId: number },
	milestone: number | null,
	userId: string,
) {
	try {
		await setThreadMilestone(thread, milestone, userId);
	} catch (error) {
		if (error instanceof UnknownMilestoneError) throw invalidMilestoneError();
		throw error;
	}
}

/**
 * `assignees`, plus the deprecated singular `assignee` (one login; `null`
 * clears it). Undefined when neither is sent, so the assignees stay as they are.
 */
function assigneesOf(data: {
	assignee?: string | null;
	assignees?: string[];
}): string[] | undefined {
	if (data.assignee === undefined) return data.assignees;
	return [
		...new Set([
			...(data.assignees ?? []),
			...(data.assignee ? [data.assignee] : []),
		]),
	];
}

export async function listIssues(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	// An invalid state is 422 (GitHub's rule); sort and direction fall back.
	const filters = queryParams(ctx, "issues/list-for-repo", "Issue");
	if (!params.reachable) return json([], 200, {});
	// Issues and pull requests together, one query: a merged pull request is
	// `closed` here, as on GitHub.
	const { threads, total } = await perfStep("db: list issues", () =>
		listThreads(
			{
				repoId: repo.id,
				...(filters.state !== "all" && { state: filters.state }),
				...(filters.assignee && { assignees: [filters.assignee] }),
				...(filters.creator && { authors: [filters.creator] }),
				...(filters.mentioned && { mentions: [filters.mentioned] }),
				...(filters.type && {
					kind: filters.type === "pr" ? "pull_request" : "issue",
				}),
				...(filters.since && { updatedSince: new Date(filters.since) }),
				labels: filters.labels ?? [],
				...(filters.milestone !== undefined && {
					milestoneNumber:
						filters.milestone === "*" || filters.milestone === "none"
							? filters.milestone
							: Number(filters.milestone),
				}),
			},
			{
				sort: { by: filters.sort, direction: filters.direction },
				limit: params.perPage,
				offset: params.offset,
			},
		),
	);
	const body = await serializeThreads(repo, threads);
	return json(body, 200, linkHeader(ctx.url, params, total));
}

export async function getIssue(ctx: ApiContext) {
	const { issue_number } = pathParams(ctx, "issues/get");
	const { repo } = await readableRepository(ctx);
	const thread = await findThread(repo.id, issue_number);
	if (!thread) throw notFoundError();
	return json(await serializeThread(repo, thread, true));
}

export async function createIssue(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You can't open issues in this repository");
	}
	const data = await requestBody(ctx, "issues/create", "Issue");
	// Labels and assignees are triage: a participant without write access opens
	// the issue unlabeled and unassigned, as on GitHub.
	// An unknown milestone is rejected before anything is created.
	const milestone = access.canWrite ? (data.milestone ?? null) : null;
	if (
		milestone !== null &&
		!(await findMilestoneByNumber(repo.id, milestone))
	) {
		throw invalidMilestoneError();
	}
	const created = await createIssueForUser(repo.id, caller.userId, {
		title: data.title,
		body: data.body ?? undefined,
		labels: access.canWrite ? (data.labels ?? []) : [],
		assignees: access.canWrite ? assigneesOf(data) : undefined,
	});
	if (milestone !== null) {
		await applyMilestone(created, milestone, caller.userId);
	}
	const thread = await findThread(repo.id, created.number);
	if (!thread) throw new Error("Issue missing after insert");
	return json(await serializeThread(repo, thread), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/issues/${created.number}`),
	});
}

export async function updateIssue(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const { issue_number: number } = pathParams(ctx, "issues/update");
	const issue = await findThread(repo.id, number);
	if (!issue) throw notFoundError();
	if (issue.authorId !== caller.userId && !access.canWrite) {
		throw forbiddenError("You do not have permission to edit this issue");
	}
	const data = await requestBody(ctx, "issues/update", "Issue");
	// An unknown milestone is rejected before any edit is written.
	if (
		access.canWrite &&
		typeof data.milestone === "number" &&
		!(await findMilestoneByNumber(repo.id, data.milestone))
	) {
		throw invalidMilestoneError();
	}
	// The state the issue ends in decides which reasons make sense: `reopened`
	// only on an open issue, `completed`/`not_planned` only on a closed one.
	const finalState = data.state ?? issue.status;
	// GitHub only applies state reasons to issues, never pull requests.
	const reason =
		issue.kind === "issue" ? (data.state_reason ?? undefined) : undefined;
	if (
		reason !== undefined &&
		(reason === "reopened") !== (finalState === "open")
	) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Issue", field: "state_reason", code: "invalid" },
		]);
	}
	const fields = {
		...(data.title !== undefined && { title: data.title }),
		...(data.body !== undefined && { body: data.body ?? "" }),
	};
	if (issue.kind === "pull_request") {
		const pr = pullRequestOfThread(issue);
		if (pr.status === "merged" && data.state === "open") {
			throw validationFailedError("Validation Failed", [
				{
					resource: "Issue",
					code: "custom",
					message: "A merged pull request can't be reopened",
				},
			]);
		}
		await updatePullRequestFields(pr, caller.userId, {
			...fields,
			...(data.state !== undefined &&
				pr.status !== "merged" && { status: data.state }),
		});
	} else {
		await updateIssueThreadFields(issue, caller.userId, {
			...(reason !== undefined &&
				reason !== "reopened" && { stateReason: reason }),
			...fields,
			...(data.state !== undefined && { status: data.state }),
		});
	}
	// As on GitHub, a caller without write access can edit their own issue's
	// title, body and state but not its labels or assignees.
	if (access.canWrite) {
		if (data.labels !== undefined) {
			await setThreadLabels(issue, data.labels, caller.userId);
		}
		const assignees = assigneesOf(data);
		if (assignees !== undefined) {
			await replaceThreadAssignees(issue, assignees, caller.userId);
		}
		if (data.milestone !== undefined) {
			await applyMilestone(issue, data.milestone, caller.userId);
		}
	}
	const thread = await findThread(repo.id, number);
	if (!thread) throw new Error("Issue missing after update");
	return json(await serializeThread(repo, thread));
}
