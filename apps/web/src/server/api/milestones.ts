/**
 * GitHub's milestones at `/api/v3`: a repository's milestones (CRUD by
 * number). Setting a milestone on an issue or pull request goes through
 * `issues/create` and `issues/update` (see ./issues.ts). Writing needs write
 * access, as on GitHub.
 */
import {
	createMilestone as createRepoMilestone,
	DuplicateMilestoneError,
	deleteMilestone as deleteRepoMilestone,
	findMilestoneByNumber,
	listMilestones,
	updateMilestone as updateRepoMilestone,
} from "../milestone-store";
import { type ApiContext, requireScope } from "./auth";
import {
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { milestone } from "./serializers";
import { fullNameOf } from "./threads";

const duplicateTitleError = () =>
	validationFailedError("Validation Failed", [
		{ resource: "Milestone", field: "title", code: "already_exists" },
	]);

function writeAccess(access: { canWrite: boolean }) {
	if (!access.canWrite) {
		throw forbiddenError(
			"You do not have permission to manage milestones on this repository",
		);
	}
}

export async function listRepoMilestones(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const filters = queryParams(ctx, "issues/list-milestones", "Milestone");
	if (!params.reachable) return json([], 200, {});
	const { milestones, total } = await listMilestones(repo.id, {
		state: filters.state,
		sort: filters.sort,
		direction: filters.direction,
		limit: params.perPage,
		offset: params.offset,
	});
	const repoRef = { fullName: fullNameOf(repo) };
	return json(
		milestones.map((value) => milestone(repoRef, value)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function createMilestone(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	writeAccess(access);
	const data = await requestBody(ctx, "issues/create-milestone", "Milestone");
	try {
		const created = await createRepoMilestone(repo.id, caller.userId, {
			title: data.title,
			state: data.state,
			description: data.description,
			dueOn: data.due_on ? new Date(data.due_on) : null,
		});
		return json(milestone({ fullName: fullNameOf(repo) }, created), 201);
	} catch (error) {
		if (error instanceof DuplicateMilestoneError) throw duplicateTitleError();
		throw error;
	}
}

export async function getMilestone(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { milestone_number } = pathParams(ctx, "issues/get-milestone");
	const value = await findMilestoneByNumber(repo.id, milestone_number);
	if (!value) throw notFoundError();
	return json(milestone({ fullName: fullNameOf(repo) }, value));
}

export async function updateMilestone(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	writeAccess(access);
	const { milestone_number } = pathParams(ctx, "issues/update-milestone");
	if (!(await findMilestoneByNumber(repo.id, milestone_number))) {
		throw notFoundError();
	}
	const data = await requestBody(ctx, "issues/update-milestone", "Milestone");
	try {
		const updated = await updateRepoMilestone(repo.id, milestone_number, {
			...(data.title !== undefined && { title: data.title }),
			...(data.state !== undefined && { state: data.state }),
			...(data.description !== undefined && { description: data.description }),
			...(data.due_on !== undefined && {
				dueOn: data.due_on ? new Date(data.due_on) : null,
			}),
		});
		if (!updated) throw notFoundError();
		return json(milestone({ fullName: fullNameOf(repo) }, updated));
	} catch (error) {
		if (error instanceof DuplicateMilestoneError) throw duplicateTitleError();
		throw error;
	}
}

export async function deleteMilestone(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	writeAccess(access);
	const { milestone_number } = pathParams(ctx, "issues/delete-milestone");
	if (!(await deleteRepoMilestone(repo.id, milestone_number))) {
		throw notFoundError();
	}
	return noContent();
}
