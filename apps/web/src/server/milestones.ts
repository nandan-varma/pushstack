import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	MAX_LIST_SKIP,
	MAX_MILESTONE_DESCRIPTION_CHARS,
	MAX_MILESTONE_TITLE_CHARS,
} from "#/lib/limits";
import {
	countMilestones,
	createMilestone as createRepoMilestone,
	DuplicateMilestoneError,
	deleteMilestone as deleteRepoMilestone,
	findMilestoneByNumber,
	listMilestones,
	setThreadMilestone as setMilestoneOnThread,
	UnknownMilestoneError,
	updateMilestone as updateRepoMilestone,
} from "./milestone-store";
import { threadNumberSchema } from "./read-input";
import {
	getViewerRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import { findThreadByNumber, listThreads } from "./thread-store";

const titleSchema = z.string().trim().min(1).max(MAX_MILESTONE_TITLE_CHARS);
const descriptionSchema = z.string().max(MAX_MILESTONE_DESCRIPTION_CHARS);
const dueOnSchema = z.coerce.date().nullable();

function userFacing<T>(run: () => Promise<T>): Promise<T> {
	return run().catch((error: unknown) => {
		if (error instanceof DuplicateMilestoneError) {
			throw new Error("A milestone with this title already exists");
		}
		if (error instanceof UnknownMilestoneError) throw notFound();
		throw error;
	});
}

/** A repository's milestones of one state, with the open and closed totals for the tabs. */
export const getMilestones = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			state: z.enum(["open", "closed", "all"]).default("open"),
			sort: z.enum(["due_on", "completeness"]).default("due_on"),
		}),
	)
	.handler(({ data }) =>
		readWithAccess("getMilestones", data.repoId, async () => {
			const [{ milestones }, counts, viewer] = await Promise.all([
				listMilestones(data.repoId, {
					state: data.state,
					sort: data.sort,
					direction: data.sort === "due_on" ? "asc" : "desc",
					limit: 100,
				}),
				countMilestones(data.repoId),
				getViewerRepositoryAccess(data.repoId),
			]);
			return { milestones, counts, viewer };
		}),
	);

export const getMilestoneByNumber = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), number: threadNumberSchema }))
	.handler(({ data }) =>
		readWithAccess("getMilestoneByNumber", data.repoId, async () => {
			const [milestone, viewer] = await Promise.all([
				findMilestoneByNumber(data.repoId, data.number),
				getViewerRepositoryAccess(data.repoId),
			]);
			if (!milestone) throw notFound();
			return { milestone, viewer };
		}),
	);

/** The issues and pull requests in a milestone, one state at a time. */
export const getMilestoneThreads = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			number: threadNumberSchema,
			state: z.enum(["open", "closed"]).default("open"),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(({ data }) =>
		readWithAccess("getMilestoneThreads", data.repoId, async () => {
			const { threads } = await listThreads(
				{
					repoId: data.repoId,
					state: data.state,
					milestoneNumber: data.number,
				},
				{ limit: 100, offset: data.skip },
			);
			return threads.map((thread) => ({
				id: thread.id,
				kind: thread.kind,
				number: thread.number,
				title: thread.title,
				status: thread.pullRequest?.mergedAt ? "merged" : thread.status,
				createdAt: thread.createdAt,
				author: thread.author,
				labels: thread.labels,
			}));
		}),
	);

export const createMilestone = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: titleSchema,
			description: descriptionSchema.optional(),
			dueOn: dueOnSchema.optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, (_repo, user) =>
			userFacing(() =>
				createRepoMilestone(data.repoId, user.id, {
					title: data.title,
					description: data.description,
					dueOn: data.dueOn,
				}),
			),
		),
	);

export const updateMilestone = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			number: threadNumberSchema,
			title: titleSchema.optional(),
			description: descriptionSchema.optional(),
			dueOn: dueOnSchema.optional(),
			state: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			const { repoId, number, ...fields } = data;
			const milestone = await userFacing(() =>
				updateRepoMilestone(repoId, number, fields),
			);
			if (!milestone) throw notFound();
			return milestone;
		}),
	);

export const deleteMilestone = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), number: threadNumberSchema }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			if (!(await deleteRepoMilestone(data.repoId, data.number))) {
				throw notFound();
			}
		}),
	);

/** Put issue or pull request `#number` in a milestone (`null` clears it); write access. */
export const setThreadMilestone = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			number: threadNumberSchema,
			milestone: threadNumberSchema.nullable(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (_repo, user) => {
			const thread = await findThreadByNumber(data.repoId, data.number);
			if (!thread) throw notFound();
			await userFacing(() =>
				setMilestoneOnThread(thread, data.milestone, user.id),
			);
		}),
	);
