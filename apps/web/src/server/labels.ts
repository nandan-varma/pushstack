/** Server functions for repository labels. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues, labels, pullRequests } from "#/db/app-schema";
import {
	labelColorSchema,
	labelDescriptionSchema,
	labelNameSchema,
} from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import { listLabels, setThreadLabels } from "./label-store";
import {
	getViewerRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import { isUniqueViolation } from "./repository-create";

export const getLabels = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getLabels", data.repoId, async () => ({
			labels: await listLabels(data.repoId),
			viewer: await getViewerRepositoryAccess(data.repoId),
		})),
	);

const duplicateName = () => new Error("A label with this name already exists");

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
			const [label] = await db
				.insert(labels)
				.values({
					repoId: data.repoId,
					name: data.name,
					color: data.color,
					description: data.description || null,
				})
				.returning()
				.catch((error: unknown) => {
					throw isUniqueViolation(error) ? duplicateName() : error;
				});
			if (!label) throw new Error("Label insert returned no row");
			return label;
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
			const { repoId, labelId, description, ...fields } = data;
			const changes = {
				...fields,
				...(description !== undefined && { description: description || null }),
			};
			if (Object.keys(changes).length === 0) {
				const existing = await db.query.labels.findFirst({
					where: { id: labelId, repoId: repoId },
				});
				if (!existing) throw notFound();
				return existing;
			}
			const [label] = await db
				.update(labels)
				.set(changes)
				.where(and(eq(labels.id, labelId), eq(labels.repoId, repoId)))
				.returning()
				.catch((error: unknown) => {
					throw isUniqueViolation(error) ? duplicateName() : error;
				});
			if (!label) throw notFound();
			return label;
		}),
	);

/** Deleting a label removes it from every issue and pull request. */
export const deleteLabel = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), labelId: z.number() }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async () => {
			const deleted = await db
				.delete(labels)
				.where(and(eq(labels.id, data.labelId), eq(labels.repoId, data.repoId)))
				.returning({ id: labels.id });
			if (deleted.length === 0) throw notFound();
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
			const [issue, pr] = await Promise.all([
				db
					.select({ n: sql<number>`1` })
					.from(issues)
					.where(
						and(eq(issues.repoId, data.repoId), eq(issues.number, data.number)),
					),
				db
					.select({ n: sql<number>`1` })
					.from(pullRequests)
					.where(
						and(
							eq(pullRequests.repoId, data.repoId),
							eq(pullRequests.number, data.number),
						),
					),
			]);
			if (issue.length === 0 && pr.length === 0) throw notFound();
			return setThreadLabels(data.repoId, data.number, data.labels, user.id);
		}),
	);
