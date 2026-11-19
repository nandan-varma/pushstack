import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_PROJECT_BOARD_ITEMS,
	MAX_PROJECT_DESCRIPTION_CHARS,
	MAX_PROJECT_FIELD_NAME_CHARS,
	MAX_PROJECT_FIELDS,
	MAX_PROJECT_FILTER_CHARS,
	MAX_PROJECT_OPTION_NAME_CHARS,
	MAX_PROJECT_SINGLE_SELECT_OPTIONS,
	MAX_PROJECT_TEXT_VALUE_CHARS,
	MAX_PROJECT_TITLE_CHARS,
	MAX_PROJECTS_PER_USER,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import {
	matchesProjectFilter,
	type ProjectFilterItem,
	type ProjectItemKind,
	parseProjectFilter,
} from "#/lib/project-filter";
import { perfContext } from "./perf-log";
import {
	addProjectItem,
	clearProjectItemFieldValue,
	createProjectField,
	createProjectForUser,
	findProjectByOwnerAndNumber,
	findProjectField,
	findProjectOwner,
	findReadableProjectItem,
	listProjectBoardItems,
	listProjectFieldOptions,
	listProjectFields,
	listProjectItemFieldValuesForItems,
	listProjectsForOwner,
	listProjectsForRepository,
	optionIdOf,
	type ProjectBoardItem,
	type ProjectFieldView,
	type ProjectItemFieldValue,
	projectAccess,
	searchAddableProjectItems,
	setProjectItemFieldValue,
	updateProjectDraftIssue,
	updateProjectField,
} from "./project-store";
import { readRepoByName } from "./repository-lookup";
import { getCurrentUser, getCurrentUserOptional } from "./session";

const PROJECT_PAGE_SIZE = 20;
const ITEM_PAGE_SIZE = 50;

export interface ProjectSummary {
	number: number;
	title: string;
	shortDescription: string | null;
	public: boolean;
	closed: boolean;
}

export interface ProjectField {
	id: number;
	name: string;
	dataType: ProjectFieldView["dataType"];
	options: { id: string; name: string; color: string }[];
}

export type { ProjectFieldValueInput } from "./project-store";

export interface ProjectTableRow extends ProjectFilterItem {
	id: number;
	/** Null for a draft, which has no issue or pull request to link to. */
	repoOwner: string | null;
	repoName: string | null;
	number: number | null;
	/** A draft's markdown body, rendered by the table. */
	body: string | null;
	/** The item's own update time, newest-first sorting for the board. */
	updatedAt: string;
}

function displayValue(
	value: ProjectItemFieldValue,
	optionNames: ReadonlyMap<number, string>,
): string | null {
	switch (value.field.dataType) {
		case "TEXT":
			return value.value.valueText;
		case "NUMBER":
			return value.value.valueNumber === null
				? null
				: String(value.value.valueNumber);
		case "DATE":
			return value.value.valueDate;
		case "SINGLE_SELECT":
			return value.value.optionId === null
				? null
				: (optionNames.get(value.value.optionId) ?? null);
	}
}

function itemKind(item: ProjectBoardItem): ProjectItemKind {
	if (item.issueId === null) return "draft";
	return item.contentKind === "pull_request" ? "pull_request" : "issue";
}

/**
 * A page of a project's item rows: each value by field name, drafts by their
 * own title and body, issues and pull requests by the repository they live in.
 */
function tableRows(
	items: ProjectBoardItem[],
	values: ProjectItemFieldValue[],
	fieldNames: readonly string[],
	optionNames: ReadonlyMap<number, string>,
): ProjectTableRow[] {
	const byItem = new Map<number, ProjectItemFieldValue[]>();
	for (const entry of values) {
		const group = byItem.get(entry.value.itemId) ?? [];
		group.push(entry);
		byItem.set(entry.value.itemId, group);
	}
	return items.map((item) => {
		const fields: Record<string, string | null> = Object.fromEntries(
			fieldNames.map((name) => [name, null]),
		);
		for (const entry of byItem.get(item.id) ?? []) {
			fields[entry.field.name.toLowerCase()] = displayValue(entry, optionNames);
		}
		const kind = itemKind(item);
		return {
			id: item.id,
			kind,
			title: item.draftTitle ?? item.contentTitle ?? "",
			repoOwner: kind === "draft" ? null : item.repoOwner,
			repoName: kind === "draft" ? null : item.repoName,
			number: kind === "draft" ? null : item.contentNumber,
			body: kind === "draft" ? item.draftBody : null,
			updatedAt: item.updatedAt.toISOString(),
			values: fields,
		};
	});
}

function fieldView(
	field: ProjectFieldView,
	options: ReadonlyMap<number, { id: number; name: string; color: string }[]>,
): ProjectField {
	return {
		id: field.id,
		name: field.name,
		dataType: field.dataType,
		options: (options.get(field.id) ?? []).map((option) => ({
			id: optionIdOf(option),
			name: option.name,
			color: option.color,
		})),
	};
}

export const getUserProjects = createServerFn({ method: "GET" })
	.validator(
		z.object({
			login: z.string().min(1),
			page: z
				.number()
				.int()
				.min(1)
				.max(Math.ceil(MAX_PROJECTS_PER_USER / PROJECT_PAGE_SIZE))
				.default(1),
		}),
	)
	.handler(({ data }) =>
		perfContext(`getUserProjects ${data.login}`, async () => {
			const owner = await findProjectOwner(data.login);
			if (!owner) throw notFound();
			const viewer = await getCurrentUserOptional();
			const { projects, total } = await listProjectsForOwner(
				owner.id,
				viewer?.id,
				{
					offset: (data.page - 1) * PROJECT_PAGE_SIZE,
					limit: PROJECT_PAGE_SIZE,
				},
			);
			return {
				login: owner.username,
				viewerIsOwner: viewer?.id === owner.id,
				projects: projects.map(
					(project): ProjectSummary => ({
						number: project.number,
						title: project.title,
						shortDescription: project.shortDescription,
						public: project.public,
						closed: project.closed,
					}),
				),
				total,
				page: data.page,
				pageCount: Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE)),
			};
		}),
	);

export const getUserProject = createServerFn({ method: "GET" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			q: z.string().max(MAX_PROJECT_FILTER_CHARS).optional(),
			page: z.number().int().min(1).max(MAX_LIST_SKIP).default(1),
		}),
	)
	.handler(({ data }) =>
		perfContext(`getUserProject ${data.login}/${data.number}`, async () => {
			const viewer = await getCurrentUserOptional();
			const project = await findProjectByOwnerAndNumber(
				data.login,
				data.number,
				viewer?.id,
			);
			if (!project) throw notFound();
			const [{ fields }, options, { items, total: itemCount }] =
				await Promise.all([
					listProjectFields(project.id, {
						offset: 0,
						limit: MAX_PROJECT_FIELDS,
					}),
					listProjectFieldOptions(project.id),
					listProjectBoardItems(project.id, viewer?.id, {
						offset: 0,
						limit: MAX_PROJECT_BOARD_ITEMS,
					}),
				]);
			const values = await listProjectItemFieldValuesForItems(
				items.map((item) => item.id),
			);
			const optionNames = new Map(
				options.map((option) => [option.id, option.name]),
			);
			const optionsByField = new Map<
				number,
				{ id: number; name: string; color: string }[]
			>();
			for (const option of options) {
				const group = optionsByField.get(option.fieldId) ?? [];
				group.push({
					id: option.id,
					name: option.name,
					color: option.color,
				});
				optionsByField.set(option.fieldId, group);
			}
			const rows = tableRows(
				items,
				values,
				fields.map((field) => field.name.toLowerCase()),
				optionNames,
			);
			const filter = parseProjectFilter(data.q ?? "");
			const filtered = rows.filter((row) => matchesProjectFilter(row, filter));
			const start = (data.page - 1) * ITEM_PAGE_SIZE;
			return {
				project: {
					number: project.number,
					title: project.title,
					shortDescription: project.shortDescription,
					public: project.public,
					closed: project.closed,
					ownerLogin: data.login,
				},
				canWrite: projectAccess(project, viewer?.id).canWrite,
				fields: fields.map((field) => fieldView(field, optionsByField)),
				items: filtered.slice(start, start + ITEM_PAGE_SIZE),
				total: filtered.length,
				itemCount,
				truncated: itemCount > MAX_PROJECT_BOARD_ITEMS,
				page: data.page,
				pageCount: Math.max(1, Math.ceil(filtered.length / ITEM_PAGE_SIZE)),
			};
		}),
	);

const FIELD_DATA_TYPES = ["TEXT", "NUMBER", "DATE", "SINGLE_SELECT"] as const;

const optionSchema = z.object({
	id: z.string().min(1).max(20).optional(),
	name: z.string().min(1).max(MAX_PROJECT_OPTION_NAME_CHARS),
	color: z.string().min(1).max(20).optional(),
});

/**
 * The project a write targets: its owner is the signed-in viewer. A missing
 * or private project is NOT_FOUND; someone else's public project is a 403.
 */
async function writableProject(
	login: string,
	number: number,
): Promise<{ projectId: number; ownerId: string; viewerId: string }> {
	const viewer = await getCurrentUser();
	const project = await findProjectByOwnerAndNumber(login, number, viewer.id);
	if (!project) throw notFound();
	if (viewer.id !== project.ownerId) throw new Error("Access denied");
	return {
		projectId: project.id,
		ownerId: project.ownerId,
		viewerId: viewer.id,
	};
}

/** The item a write targets, checked to belong to the project being written. */
async function writableItem(
	itemId: number,
	projectId: number,
	viewerId: string,
) {
	const item = await findReadableProjectItem(itemId, viewerId);
	if (!item || item.projectId !== projectId) throw notFound();
	return item;
}

export const createUserProject = createServerFn({ method: "POST" })
	.validator(
		z.object({
			title: z.string().min(1).max(MAX_PROJECT_TITLE_CHARS),
			shortDescription: z.string().max(MAX_PROJECT_DESCRIPTION_CHARS).nullish(),
			public: z.boolean().default(false),
		}),
	)
	.handler(({ data }) =>
		perfContext("createUserProject", async () => {
			const viewer = await getCurrentUser();
			const project = await createProjectForUser(viewer.id, {
				title: data.title,
				shortDescription: data.shortDescription ?? null,
				public: data.public,
			});
			return { number: project.number };
		}),
	);

export const createUserProjectField = createServerFn({ method: "POST" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			name: z.string().min(1).max(MAX_PROJECT_FIELD_NAME_CHARS),
			dataType: z.enum(FIELD_DATA_TYPES),
			options: z
				.array(optionSchema.omit({ id: true }))
				.max(MAX_PROJECT_SINGLE_SELECT_OPTIONS)
				.optional(),
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`createUserProjectField ${data.login}/${data.number}`,
			async () => {
				const { projectId, ownerId } = await writableProject(
					data.login,
					data.number,
				);
				const field = await createProjectField(projectId, ownerId, {
					name: data.name,
					dataType: data.dataType,
					options: data.options,
				});
				return { id: field.id };
			},
		),
	);

export const updateUserProjectField = createServerFn({ method: "POST" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			fieldId: z.number().int().min(1),
			name: z.string().min(1).max(MAX_PROJECT_FIELD_NAME_CHARS).optional(),
			options: z
				.array(optionSchema)
				.max(MAX_PROJECT_SINGLE_SELECT_OPTIONS)
				.optional(),
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`updateUserProjectField ${data.login}/${data.number}`,
			async () => {
				const { projectId, ownerId } = await writableProject(
					data.login,
					data.number,
				);
				if (data.name === undefined && data.options === undefined) return;
				const field = await findProjectField(data.fieldId);
				if (!field || field.projectId !== projectId) throw notFound();
				const updated = await updateProjectField(data.fieldId, ownerId, {
					name: data.name,
					options: data.options,
				});
				if (!updated) throw notFound();
			},
		),
	);

export const addUserProjectItem = createServerFn({ method: "POST" })
	.validator(
		z
			.object({
				login: z.string().min(1),
				number: z.number().int().min(1),
				issueId: z.number().int().min(1).optional(),
				draftTitle: z.string().min(1).max(MAX_THREAD_TITLE_CHARS).optional(),
				draftBody: z.string().max(MAX_BODY_CHARS).nullish(),
			})
			.refine(
				(data) =>
					(data.issueId === undefined) !== (data.draftTitle === undefined),
				"An item is either an existing issue or a draft with a title",
			),
	)
	.handler(({ data }) =>
		perfContext(`addUserProjectItem ${data.login}/${data.number}`, async () => {
			const { projectId, ownerId } = await writableProject(
				data.login,
				data.number,
			);
			// The refine above guarantees exactly one of issueId or draftTitle.
			const content =
				data.issueId !== undefined
					? { issueId: data.issueId }
					: {
							draftTitle: data.draftTitle ?? "",
							draftBody: data.draftBody ?? null,
						};
			const item = await addProjectItem(projectId, ownerId, content);
			return { id: item.id };
		}),
	);

export const updateUserProjectDraft = createServerFn({ method: "POST" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			itemId: z.number().int().min(1),
			title: z.string().min(1).max(MAX_THREAD_TITLE_CHARS),
			body: z.string().max(MAX_BODY_CHARS).nullish(),
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`updateUserProjectDraft ${data.login}/${data.number}`,
			async () => {
				const { projectId, ownerId, viewerId } = await writableProject(
					data.login,
					data.number,
				);
				const item = await writableItem(data.itemId, projectId, viewerId);
				if (item.issueId !== null) throw notFound();
				const updated = await updateProjectDraftIssue(data.itemId, ownerId, {
					title: data.title,
					body: data.body ?? null,
				});
				if (!updated) throw notFound();
			},
		),
	);

const fieldValueSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("TEXT"),
		text: z.string().max(MAX_PROJECT_TEXT_VALUE_CHARS),
	}),
	z.object({ type: z.literal("NUMBER"), number: z.number().finite() }),
	z.object({
		type: z.literal("DATE"),
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	}),
	z.object({
		type: z.literal("SINGLE_SELECT"),
		optionId: z.string().min(1).max(20),
	}),
]);

export const setUserProjectItemFieldValue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			itemId: z.number().int().min(1),
			fieldId: z.number().int().min(1),
			value: fieldValueSchema,
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`setUserProjectItemFieldValue ${data.login}/${data.number}`,
			async () => {
				const { projectId, ownerId, viewerId } = await writableProject(
					data.login,
					data.number,
				);
				await writableItem(data.itemId, projectId, viewerId);
				const value = await setProjectItemFieldValue(
					data.itemId,
					ownerId,
					data.fieldId,
					data.value,
				);
				if (!value) throw notFound();
			},
		),
	);

export const clearUserProjectItemFieldValue = createServerFn({
	method: "POST",
})
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			itemId: z.number().int().min(1),
			fieldId: z.number().int().min(1),
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`clearUserProjectItemFieldValue ${data.login}/${data.number}`,
			async () => {
				const { projectId, ownerId, viewerId } = await writableProject(
					data.login,
					data.number,
				);
				await writableItem(data.itemId, projectId, viewerId);
				await clearProjectItemFieldValue(data.itemId, ownerId, data.fieldId);
			},
		),
	);

export const searchUserProjectAddableItems = createServerFn({ method: "GET" })
	.validator(
		z.object({
			login: z.string().min(1),
			number: z.number().int().min(1),
			query: z.string().max(MAX_PROJECT_FILTER_CHARS).default(""),
		}),
	)
	.handler(({ data }) =>
		perfContext(
			`searchUserProjectAddableItems ${data.login}/${data.number}`,
			async () => {
				const viewer = await getCurrentUser();
				const project = await findProjectByOwnerAndNumber(
					data.login,
					data.number,
					viewer.id,
				);
				if (!project || viewer.id !== project.ownerId) throw notFound();
				const items = await searchAddableProjectItems(
					project.id,
					viewer.id,
					data.query,
					ITEM_PAGE_SIZE,
				);
				return { items };
			},
		),
	);

export const getRepositoryProjects = createServerFn({ method: "GET" })
	.validator(
		z.object({
			owner: z.string().min(1),
			name: z.string().min(1),
			page: z
				.number()
				.int()
				.min(1)
				.max(Math.ceil(MAX_PROJECTS_PER_USER / PROJECT_PAGE_SIZE))
				.default(1),
		}),
	)
	.handler(({ data }) =>
		perfContext(`getRepositoryProjects ${data.owner}/${data.name}`, async () =>
			readRepoByName(
				"getRepositoryProjects",
				data.owner,
				data.name,
				async (repo) => {
					const viewer = await getCurrentUserOptional();
					const { projects, total } = await listProjectsForRepository(
						repo.id,
						viewer?.id,
						{
							offset: (data.page - 1) * PROJECT_PAGE_SIZE,
							limit: PROJECT_PAGE_SIZE,
						},
					);
					return {
						projects: projects.map(
							(project): ProjectSummary & { ownerLogin: string } => ({
								number: project.number,
								title: project.title,
								shortDescription: project.shortDescription,
								public: project.public,
								closed: project.closed,
								ownerLogin: project.ownerLogin,
							}),
						),
						total,
						page: data.page,
						pageCount: Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE)),
					};
				},
			),
		),
	);
