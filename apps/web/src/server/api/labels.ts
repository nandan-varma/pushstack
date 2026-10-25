/**
 * GitHub's labels at `/api/v3`: a repository's labels (CRUD by name) and the
 * issue-label sub-resource (add, set, remove). A label name in the path is
 * percent-encoded by clients; the dispatcher decodes each segment.
 */
import {
	createRepoLabel,
	DuplicateLabelError,
	deleteRepoLabelById,
	findLabelByName,
	labelsOfThread,
	listLabelsPage,
	setThreadLabels,
	UnknownLabelError,
	updateRepoLabelById,
} from "../label-store";
import { findThreadByNumber } from "../thread-store";
import { type ApiContext, requireScope } from "./auth";
import {
	type FieldError,
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { label } from "./serializers";
import { fullNameOf } from "./threads";

const duplicateLabelError = () =>
	validationFailedError("Validation Failed", [
		{ resource: "Label", field: "name", code: "already_exists" },
	]);

function labelWriteAccess(access: { canWrite: boolean }) {
	if (!access.canWrite) {
		throw forbiddenError(
			"You do not have permission to manage labels on this repository",
		);
	}
}

/** Apply `names` to `#number`, mapping unknown names to GitHub's 422. */
async function applyThreadLabels(
	thread: { id: number; repoId: number },
	names: string[],
	userId: string,
) {
	try {
		return await setThreadLabels(thread, names, userId);
	} catch (error) {
		if (error instanceof UnknownLabelError) {
			throw validationFailedError(
				"Validation Failed",
				error.names.map(
					(name): FieldError => ({
						resource: "Label",
						field: "name",
						code: "custom",
						message: `Label: ${name} does not exist`,
					}),
				),
			);
		}
		throw error;
	}
}

export async function listRepoLabels(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, {});
	const { labels, total } = await listLabelsPage(repo.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	const fullName = `${repo.owner.username}/${repo.name}`;
	return json(
		labels.map((value) => label({ fullName }, value)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function createLabel(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const data = await requestBody(ctx, "issues/create-label", "Label");
	try {
		const created = await createRepoLabel(repo.id, {
			name: data.name,
			color: data.color,
			description: data.description ?? undefined,
		});
		return json(
			label({ fullName: `${repo.owner.username}/${repo.name}` }, created),
			201,
		);
	} catch (error) {
		if (error instanceof DuplicateLabelError) throw duplicateLabelError();
		throw error;
	}
}

type LabelOperation =
	| "issues/get-label"
	| "issues/update-label"
	| "issues/delete-label";

async function requireLabel(
	ctx: ApiContext,
	id: LabelOperation,
	repoId: number,
) {
	const { name } = pathParams(ctx, id);
	const label = await findLabelByName(repoId, name);
	if (!label) throw notFoundError();
	return label;
}

export async function getLabel(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const value = await requireLabel(ctx, "issues/get-label", repo.id);
	return json(
		label({ fullName: `${repo.owner.username}/${repo.name}` }, value),
	);
}

export async function updateLabel(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const existing = await requireLabel(ctx, "issues/update-label", repo.id);
	const data = await requestBody(ctx, "issues/update-label", "Label");
	try {
		const updated = await updateRepoLabelById(repo.id, existing.id, {
			...(data.new_name !== undefined && { name: data.new_name }),
			...(data.color !== undefined && { color: data.color }),
			...(data.description !== undefined && {
				description: data.description ?? "",
			}),
		});
		if (!updated) throw notFoundError();
		return json(
			label({ fullName: `${repo.owner.username}/${repo.name}` }, updated),
		);
	} catch (error) {
		if (error instanceof DuplicateLabelError) throw duplicateLabelError();
		throw error;
	}
}

export async function deleteLabel(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const existing = await requireLabel(ctx, "issues/delete-label", repo.id);
	if (!(await deleteRepoLabelById(repo.id, existing.id))) throw notFoundError();
	return noContent();
}

type IssueLabelsOperation =
	| "issues/list-labels-on-issue"
	| "issues/add-labels"
	| "issues/set-labels"
	| "issues/remove-all-labels"
	| "issues/remove-label";

async function requireThread(
	ctx: ApiContext,
	id: IssueLabelsOperation,
	repoId: number,
) {
	const { issue_number } = pathParams(ctx, id);
	const thread = await findThreadByNumber(repoId, issue_number);
	if (!thread) throw notFoundError();
	return thread;
}

export async function listIssueLabels(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const thread = await requireThread(
		ctx,
		"issues/list-labels-on-issue",
		repo.id,
	);
	const labels = await labelsOfThread(thread.id);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}

/** `POST /repos/{owner}/{repo}/issues/{number}/labels` — add, return every label. */
export async function addIssueLabels(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, "issues/add-labels", repo.id);
	const data = await requestBody(ctx, "issues/add-labels", "Label");
	const current = await labelsOfThread(thread.id);
	const names = [
		...new Set([...current.map((value) => value.name), ...data.labels]),
	];
	const labels = await applyThreadLabels(thread, names, caller.userId);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}

/** `PUT /repos/{owner}/{repo}/issues/{number}/labels` — set exactly. */
export async function setIssueLabels(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, "issues/set-labels", repo.id);
	const data = await requestBody(ctx, "issues/set-labels", "Label");
	const labels = await applyThreadLabels(thread, data.labels, caller.userId);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}

/** `DELETE /repos/{owner}/{repo}/issues/{number}/labels` — remove every label. */
export async function deleteIssueLabels(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, "issues/remove-all-labels", repo.id);
	await applyThreadLabels(thread, [], caller.userId);
	return noContent();
}

export async function removeIssueLabel(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, "issues/remove-label", repo.id);
	const { name } = pathParams(ctx, "issues/remove-label");
	const current = await labelsOfThread(thread.id);
	const wanted = name.toLowerCase();
	const labels = await applyThreadLabels(
		thread,
		current
			.filter((value) => value.name.toLowerCase() !== wanted)
			.map((value) => value.name),
		caller.userId,
	);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}
