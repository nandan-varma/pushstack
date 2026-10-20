/** Server functions for repository labels. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	labelColorSchema,
	labelDescriptionSchema,
	labelNameSchema,
} from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import {
	createRepoLabel,
	deleteRepoLabelById,
	listLabels,
	setThreadLabels,
	updateRepoLabelById,
} from "./label-store";
import {
	getViewerRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import { findThreadByNumber } from "./thread-store";

export const getLabels = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getLabels", data.repoId, async () => ({
			labels: await listLabels(data.repoId),
			viewer: await getViewerRepositoryAccess(data.repoId),
		})),
	);

export const createLabel = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			name: labelNameSchema,
			color: labelColorSchema,
			description: labelDescriptionSchema.optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			const { repoId, ...fields } = data;
			return createRepoLabel(repoId, fields);
		}),
	);

/** Rename or recolor; threads keep the label (they reference it by id). */
export const updateLabel = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			labelId: z.number(),
			name: labelNameSchema.optional(),
			color: labelColorSchema.optional(),
			description: labelDescriptionSchema.optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			const { repoId, labelId, ...fields } = data;
			const label = await updateRepoLabelById(repoId, labelId, fields);
			if (!label) throw notFound();
			return label;
		}),
	);

/** Deleting a label removes it from every issue and pull request. */
export const deleteLabel = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), labelId: z.number() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			if (!(await deleteRepoLabelById(data.repoId, data.labelId))) {
				throw notFound();
			}
		}),
	);

/** Make issue/PR `#number` carry exactly these labels (write access). */
export const setLabels = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			number: z.number().int(),
			labels: z.array(labelNameSchema).max(MAX_LABELS_PER_THREAD),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (_repo, user) => {
			const thread = await findThreadByNumber(data.repoId, data.number);
			if (!thread) throw notFound();
			return setThreadLabels(thread, data.labels, user.id);
		}),
	);
