import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	MAX_LIST_SKIP,
	MAX_PROJECT_BOARD_ITEMS,
	MAX_PROJECT_FIELDS,
	MAX_PROJECT_FILTER_CHARS,
	MAX_PROJECTS_PER_USER,
} from "#/lib/limits";
import {
	matchesProjectFilter,
	type ProjectFilterItem,
	type ProjectItemKind,
	parseProjectFilter,
} from "#/lib/project-filter";
import { perfContext } from "./perf-log";
import {
	findProjectByOwnerAndNumber,
	findProjectOwner,
	listProjectBoardItems,
	listProjectFieldOptions,
	listProjectFields,
	listProjectItemFieldValuesForItems,
	listProjectsForOwner,
	type ProjectBoardItem,
	type ProjectFieldView,
	type ProjectItemFieldValue,
	projectAccess,
} from "./project-store";
import { getCurrentUserOptional } from "./session";

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
	name: string;
	dataType: ProjectFieldView["dataType"];
	options: { name: string; color: string }[];
}

export interface ProjectTableRow extends ProjectFilterItem {
	id: number;
	/** Null for a draft, which has no issue or pull request to link to. */
	repoOwner: string | null;
	repoName: string | null;
	number: number | null;
	/** A draft's markdown body, rendered by the table. */
	body: string | null;
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
			values: fields,
		};
	});
}

function fieldView(
	field: ProjectFieldView,
	options: ReadonlyMap<number, { name: string; color: string }[]>,
): ProjectField {
	return {
		name: field.name,
		dataType: field.dataType,
		options: options.get(field.id) ?? [],
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
				{ name: string; color: string }[]
			>();
			for (const option of options) {
				const group = optionsByField.get(option.fieldId) ?? [];
				group.push({ name: option.name, color: option.color });
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
