/**
 * GitHub's labels at `/api/v3`: a repository's labels (CRUD by name) and the
 * issue-label sub-resource (add, set, remove). A label name in the path is
 * percent-encoded by clients; the dispatcher decodes each segment.
 */
import { z } from "zod";
import {
	labelColorSchema,
	labelDescriptionSchema,
	labelNameSchema,
} from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import {
	createRepoLabel,
	DuplicateLabelError,
	deleteRepoLabelById,
	findLabelByName,
	labelsOfThread,
	listLabels,
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
	noContent,
	notFoundError,
	pagedList,
	readJsonObject,
	validationFailedError,
} from "./http";
import { readableRepository } from "./repo-lookup";
import { label } from "./serializers";
import { fullNameOf, threadNumber } from "./threads";

const createLabelSchema = z.object({
	name: labelNameSchema,
	color: labelColorSchema.default("ededed"),
	description: labelDescriptionSchema.nullish(),
});

const updateLabelSchema = z.object({
	new_name: labelNameSchema.optional(),
	color: labelColorSchema.optional(),
	description: labelDescriptionSchema.nullish(),
});

const issueLabelsSchema = z.object({
	labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD),
});

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
	const labels = await listLabels(repo.id);
	return pagedList(ctx.url, labels, (value) =>
		label({ fullName: `${repo.owner.username}/${repo.name}` }, value),
	);
}

export async function createLabel(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const body = await readJsonObject(ctx.request);
	const parsed = createLabelSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Label", field: "name", code: "invalid" },
		]);
	}
	try {
		const created = await createRepoLabel(repo.id, {
			name: parsed.data.name,
			color: parsed.data.color,
			description: parsed.data.description ?? undefined,
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

async function requireLabel(ctx: ApiContext, repoId: number) {
	const name = ctx.params.name;
	if (!name) throw notFoundError();
	const label = await findLabelByName(repoId, name);
	if (!label) throw notFoundError();
	return label;
}

export async function getLabel(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const value = await requireLabel(ctx, repo.id);
	return json(
		label({ fullName: `${repo.owner.username}/${repo.name}` }, value),
	);
}

export async function updateLabel(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const existing = await requireLabel(ctx, repo.id);
	const body = await readJsonObject(ctx.request);
	const parsed = updateLabelSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Label", field: "name", code: "invalid" },
		]);
	}
	const data = parsed.data;
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
	const existing = await requireLabel(ctx, repo.id);
	if (!(await deleteRepoLabelById(repo.id, existing.id))) throw notFoundError();
	return noContent();
}

async function requireThread(ctx: ApiContext, repoId: number) {
	const thread = await findThreadByNumber(
		repoId,
		threadNumber(ctx.params.number),
	);
	if (!thread) throw notFoundError();
	return thread;
}

export async function listIssueLabels(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const thread = await requireThread(ctx, repo.id);
	const labels = await labelsOfThread(thread.id);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}

/** `POST /repos/{owner}/{repo}/issues/{number}/labels` — add, return every label. */
export async function addIssueLabels(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, repo.id);
	const data = await parsedIssueLabels(ctx);
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
	const thread = await requireThread(ctx, repo.id);
	const data = await parsedIssueLabels(ctx);
	const labels = await applyThreadLabels(thread, data.labels, caller.userId);
	const fullName = fullNameOf(repo);
	return json(labels.map((value) => label({ fullName }, value)));
}

/** `DELETE /repos/{owner}/{repo}/issues/{number}/labels` — remove every label. */
export async function deleteIssueLabels(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, repo.id);
	await applyThreadLabels(thread, [], caller.userId);
	return noContent();
}

export async function removeIssueLabel(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	labelWriteAccess(access);
	const thread = await requireThread(ctx, repo.id);
	const name = ctx.params.name;
	if (!name) throw notFoundError();
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

/** GitHub's `{ labels: [...] }` body; 422 when it isn't one. */
async function parsedIssueLabels(ctx: ApiContext) {
	const body = await readJsonObject(ctx.request);
	const parsed = issueLabelsSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Label", field: "labels", code: "invalid" },
		]);
	}
	return parsed.data;
}
