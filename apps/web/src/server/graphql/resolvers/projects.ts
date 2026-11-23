/**
 * Projects v2 over `project-store.ts`: `User.projectsV2`,
 * `Repository.projectsV2`, `ProjectV2`, `ProjectV2Item`, the field
 * configuration types, `Issue`/`PullRequest.projectItems`, `Query.resource`,
 * the writes behind `gh project create`, `field-create`, `item-add` and
 * `item-edit`, and the `node(id:)` loaders for `PVT_`, `PVTI_`, `PVTF_` and
 * `PVTSSF_`.
 *
 * An unreadable project or item is `null` (or `NOT_FOUND` through
 * `node(id:)`), never an empty success; a project's public visibility exposes
 * an item only as far as its repository is readable.
 */
import { inArray } from "drizzle-orm";
import { db } from "#/db";
import { issues } from "#/db/app-schema";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	addProjectItem,
	clearProjectItemFieldValue,
	createProjectField,
	createProjectForUser,
	findProjectByNumber,
	findProjectField,
	findProjectItemFieldValueByName,
	findReadableProjectById,
	findReadableProjectItem,
	listFieldOptions,
	listProjectFields,
	listProjectItemFieldValues,
	listProjectItems,
	listProjectItemsForThread,
	listProjectsForOwner,
	listProjectsForRepository,
	optionIdOf,
	type ProjectFieldDataType,
	type ProjectFieldValueInput,
	type ProjectFieldValueView,
	type ProjectFieldView,
	type ProjectItemFieldValue,
	type ProjectItemWithRepo,
	ProjectValidationError,
	type ProjectView,
	projectAccess,
	setProjectItemFieldValue,
	updateProjectDraftIssue,
} from "../../project-store";
import { findRepositoryByName } from "../../repository-lookup";
import {
	findThread,
	findThreads,
	pullRequestOfThread,
	type Thread,
} from "../../thread-store";
import { type ConnectionArgs, countedConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { forbidden, notFound, unprocessable } from "../errors";
import {
	decodeNodeId,
	decodeProjectNodeId,
	encodeProjectNodeId,
	rowIdOfNodeKey,
} from "../node-id";
import { loadUser, type UserNode, userNode } from "./core";
import type {
	AddProjectV2DraftIssueInput,
	AddProjectV2ItemByIdInput,
	ClearProjectV2ItemFieldValueInput,
	CreateProjectV2FieldInput,
	CreateProjectV2Input,
	ProjectV2CustomFieldType,
	ProjectV2FieldValue,
	ProjectV2ItemType,
	ProjectV2SingleSelectFieldOptionColor,
	UpdateProjectV2DraftIssueInput,
	UpdateProjectV2ItemFieldValueInput,
} from "./generated";
import { type IssueNode, issueNode } from "./issues";
import { type PullRequestNode, pullNode } from "./pulls";
import { type RepositoryNode, repositoryNodeById } from "./repository";
import type { DomainResolvers, NodeLoader } from "./types";

type ProjectOrderInput = {
	field?: "CREATED_AT" | "NUMBER" | "TITLE" | "UPDATED_AT" | null;
	direction?: "ASC" | "DESC" | null;
};

export interface ProjectNode {
	__typename: "ProjectV2";
	id: string;
	number: number;
	title: string;
	shortDescription: string | null;
	readme: string | null;
	public: boolean;
	closed: boolean;
	closedAt: string | null;
	createdAt: string;
	updatedAt: string;
	resourcePath: string;
	url: string;
	/** Internal: the row and the owner's login, for the fields resolved lazily. */
	row: ProjectView;
	ownerLogin: string;
}

export interface ProjectItemNode {
	__typename: "ProjectV2Item";
	id: string;
	createdAt: string;
	updatedAt: string;
	isArchived: boolean;
	row: ProjectItemWithRepo;
}

export interface ProjectFieldNode {
	__typename: "ProjectV2Field" | "ProjectV2SingleSelectField";
	id: string;
	name: string;
	dataType: ProjectFieldView["dataType"];
	createdAt: string;
	updatedAt: string;
	row: ProjectFieldView;
}

export interface ProjectFieldValueNode {
	__typename:
		| "ProjectV2ItemFieldTextValue"
		| "ProjectV2ItemFieldNumberValue"
		| "ProjectV2ItemFieldDateValue"
		| "ProjectV2ItemFieldSingleSelectValue";
	id: string;
	field: ProjectFieldNode;
	updatedAt: string;
	/** The value row and the option's name/color for a single select. */
	value: ProjectFieldValueView;
}

export interface DraftIssueNode {
	__typename: "DraftIssue";
	id: string;
	title: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

type ProjectContentNode = IssueNode | PullRequestNode | DraftIssueNode;

function projectNode(row: ProjectView, ownerLogin: string): ProjectNode {
	const path = `/users/${ownerLogin}/projects/${row.number}`;
	return {
		__typename: "ProjectV2",
		id: encodeProjectNodeId("ProjectV2", row.id, row.id),
		number: row.number,
		title: row.title,
		shortDescription: row.shortDescription,
		readme: row.readme,
		public: row.public,
		closed: row.closed,
		closedAt: row.closedAt ? isoTimestamp(row.closedAt) : null,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		resourcePath: path,
		url: htmlUrl(path),
		row,
		ownerLogin,
	};
}

function fieldNode(field: ProjectFieldView): ProjectFieldNode {
	return {
		__typename:
			field.dataType === "SINGLE_SELECT"
				? "ProjectV2SingleSelectField"
				: "ProjectV2Field",
		id: encodeProjectNodeId(
			field.dataType === "SINGLE_SELECT"
				? "ProjectV2SingleSelectField"
				: "ProjectV2Field",
			field.projectId,
			field.id,
		),
		name: field.name,
		dataType: field.dataType,
		createdAt: isoTimestamp(field.createdAt),
		updatedAt: isoTimestamp(field.updatedAt),
		row: field,
	};
}

function itemNode(item: ProjectItemWithRepo): ProjectItemNode {
	return {
		__typename: "ProjectV2Item",
		id: encodeProjectNodeId("ProjectV2Item", item.projectId, item.id),
		createdAt: isoTimestamp(item.createdAt),
		updatedAt: isoTimestamp(item.updatedAt),
		isArchived: item.archived,
		row: item,
	};
}

function draftIssueNode(item: ProjectItemWithRepo): DraftIssueNode {
	return {
		__typename: "DraftIssue",
		id: encodeProjectNodeId("ProjectV2Item", item.projectId, item.id),
		title: item.draftTitle ?? "",
		body: item.draftBody ?? "",
		createdAt: isoTimestamp(item.createdAt),
		updatedAt: isoTimestamp(item.updatedAt),
	};
}

const VALUE_TYPENAMES = {
	TEXT: "ProjectV2ItemFieldTextValue",
	NUMBER: "ProjectV2ItemFieldNumberValue",
	DATE: "ProjectV2ItemFieldDateValue",
	SINGLE_SELECT: "ProjectV2ItemFieldSingleSelectValue",
} as const;

function fieldValueNode(entry: ProjectItemFieldValue): ProjectFieldValueNode {
	return {
		__typename: VALUE_TYPENAMES[entry.field.dataType],
		id: `${entry.field.id}:${entry.value.itemId}`,
		field: fieldNode(entry.field),
		updatedAt: isoTimestamp(entry.value.updatedAt),
		value: entry.value,
	};
}

/** The project a row names, for the fields and items that point back to it. */
function loadProject(
	ctx: GraphQLContext,
	projectId: number,
): Promise<ProjectNode> {
	const viewer = ctx.caller.userId;
	return ctx
		.loader<number, ProjectNode>("project-node", async (ids) => {
			const found = await Promise.all(
				ids.map((id) => findReadableProjectById(id, viewer)),
			);
			const entries = await Promise.all(
				found
					.flatMap((row) => (row ? [row] : []))
					.map(async (row) => {
						const owner = await loadUser(ctx, row.ownerId);
						return owner
							? ([row.id, projectNode(row, owner.username)] as const)
							: null;
					}),
			);
			return new Map(entries.flatMap((entry) => (entry ? [entry] : [])));
		})
		.load(projectId)
		.then((project) => {
			if (!project) throw new Error("Project missing");
			return project;
		});
}

/**
 * An item's content. Drafts carry their own text; an issue or pull request is
 * read through its repository, so content the viewer cannot read is null and
 * is omitted rather than leaked.
 */
function loadContent(
	ctx: GraphQLContext,
	issueId: number,
): Promise<ProjectContentNode | null | undefined> {
	return ctx
		.loader<number, ProjectContentNode | null>(
			"project-content",
			async (ids) => {
				const rows = await db
					.select({
						id: issues.id,
						repoId: issues.repoId,
						number: issues.number,
					})
					.from(issues)
					.where(inArray(issues.id, ids));
				const byRepo = new Map<number, typeof rows>();
				for (const row of rows) {
					const group = byRepo.get(row.repoId) ?? [];
					group.push(row);
					byRepo.set(row.repoId, group);
				}
				const found = new Map<number, ProjectContentNode | null>();
				for (const [repoId, group] of byRepo) {
					const repo = await repositoryNodeById(ctx, repoId);
					if (!repo) {
						for (const row of group) found.set(row.id, null);
						continue;
					}
					const threads = await findThreads(
						repoId,
						group.map((row) => row.number),
					);
					const byNumber = new Map(
						threads.map((thread) => [thread.number, thread]),
					);
					for (const row of group) {
						const thread = byNumber.get(row.number);
						found.set(
							row.id,
							thread
								? thread.kind === "pull_request"
									? pullNode(repo, pullRequestOfThread(thread))
									: issueNode(repo, thread)
								: null,
						);
					}
				}
				for (const id of ids) if (!found.has(id)) found.set(id, null);
				return found;
			},
		)
		.load(issueId);
}

async function threadNode(
	ctx: GraphQLContext,
	thread: Thread,
): Promise<IssueNode | PullRequestNode | null> {
	const repo = await repositoryNodeById(ctx, thread.repoId);
	if (!repo) return null;
	return thread.kind === "pull_request"
		? pullNode(repo, pullRequestOfThread(thread))
		: issueNode(repo, thread);
}

async function projectsForOwner(
	ownerId: string,
	args: {
		query?: string | null;
		orderBy?: ProjectOrderInput | null;
	} & ConnectionArgs,
	ctx: GraphQLContext,
) {
	return countedConnection(args, async (offset, limit) => {
		const { projects, total } = await listProjectsForOwner(
			ownerId,
			ctx.caller.userId,
			{
				query: args.query,
				orderBy: args.orderBy as never,
				offset,
				limit,
			},
		);
		const nodes = await Promise.all(
			projects.map(async (row) => {
				const owner = await loadUser(ctx, row.ownerId);
				if (!owner) throw new Error("Project owner missing");
				return projectNode(row, owner.username);
			}),
		);
		return { items: nodes, total };
	});
}

function projectsForRepository(
	repoId: number,
	args: {
		query?: string | null;
		orderBy?: ProjectOrderInput | null;
	} & ConnectionArgs,
	ctx: GraphQLContext,
) {
	return countedConnection(args, async (offset, limit) => {
		const { projects, total } = await listProjectsForRepository(
			repoId,
			ctx.caller.userId,
			{
				query: args.query,
				orderBy: args.orderBy as never,
				offset,
				limit,
			},
		);
		const nodes = await Promise.all(
			projects.map(async (row) => {
				const owner = await loadUser(ctx, row.ownerId);
				if (!owner) throw new Error("Project owner missing");
				return projectNode(row, owner.username);
			}),
		);
		return { items: nodes, total };
	});
}

function projectItemsConnection(
	projectId: number,
	args: {
		query?: string | null;
		archivedStates?: readonly ("ARCHIVED" | "NOT_ARCHIVED")[] | null;
	} & ConnectionArgs,
	ctx: GraphQLContext,
) {
	return countedConnection(args, async (offset, limit) => {
		const { items, total } = await listProjectItems(
			projectId,
			ctx.caller.userId,
			{
				query: args.query,
				archivedStates: args.archivedStates ?? undefined,
				offset,
				limit,
			},
		);
		return { items: items.map(itemNode), total };
	});
}

function threadItemsConnection(
	issueId: number,
	includeArchived: boolean,
	args: ConnectionArgs,
	ctx: GraphQLContext,
) {
	return countedConnection(args, async (offset, limit) => {
		const { items, total } = await listProjectItemsForThread(
			issueId,
			ctx.caller.userId,
			{ offset, limit },
			includeArchived,
		);
		return { items: items.map(itemNode), total };
	});
}

const loadProjectNode: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	return id === null ? null : loadProject(ctx, id);
};

const loadItemNode: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	if (id === null) return null;
	const item = await findReadableProjectItem(id, ctx.caller.userId);
	return item ? itemNode(item) : null;
};

async function loadFieldNode(
	key: string,
	ctx: GraphQLContext,
	singleSelect: boolean,
): Promise<ProjectFieldNode | null> {
	const id = rowIdOfNodeKey(key);
	if (id === null) return null;
	const field = await findReadableProjectField(id, ctx.caller.userId);
	if (!field) return null;
	if (singleSelect && field.dataType !== "SINGLE_SELECT") return null;
	return fieldNode(field);
}

const loadField: NodeLoader = (key, ctx) => loadFieldNode(key, ctx, false);
const loadSingleSelectField: NodeLoader = (key, ctx) =>
	loadFieldNode(key, ctx, true);

/** `Query.resource(url:)`: the issue, pull request or repository a URL names. */
async function resource(
	_source: unknown,
	args: { url: string },
	ctx: GraphQLContext,
) {
	let pathname: string;
	try {
		pathname = new URL(args.url).pathname;
	} catch {
		return null;
	}
	const [owner = "", name = "", kind, number] = pathname
		.split("/")
		.filter(Boolean);
	const repo = await findRepositoryByName(owner, name);
	if (!repo) return null;
	if (!kind) return repositoryNodeById(ctx, repo.id);
	if ((kind !== "issues" && kind !== "pull") || !/^\d+$/.test(number ?? ""))
		return null;
	const thread = await findThread(repo.id, Number(number));
	if (!thread) return null;
	if (thread.kind === "pull_request" && kind !== "pull") return null;
	if (thread.kind === "issue" && kind !== "issues") return null;
	return threadNode(ctx, thread);
}

/** A field readable through its project, for the `node(id:)` loaders. */
async function findReadableProjectField(
	fieldId: number,
	viewerId: string,
): Promise<ProjectFieldView | null> {
	const field = await findProjectField(fieldId);
	if (!field) return null;
	const project = await findReadableProjectById(field.projectId, viewerId);
	return project ? field : null;
}

const nodeNotFound = (id: string) =>
	notFound(`Could not resolve to a node with the global id of '${id}'`);

/** The store refuses a bad write with a message GitHub answers as UNPROCESSABLE. */
async function withProjectErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ProjectValidationError)
			throw unprocessable(error.message);
		throw error;
	}
}

function projectRowIdOf(id: string): number | null {
	const decoded = decodeProjectNodeId(id);
	return decoded?.type === "ProjectV2" ? rowIdOfNodeKey(decoded.key) : null;
}

/** A `DraftIssue` shares the `PVTI_` id of the item that holds it. */
function itemRowIdOf(id: string): number | null {
	const decoded = decodeProjectNodeId(id);
	return decoded?.type === "ProjectV2Item" ? rowIdOfNodeKey(decoded.key) : null;
}

function fieldRowIdOf(id: string): number | null {
	const decoded = decodeProjectNodeId(id);
	return decoded?.type === "ProjectV2Field" ||
		decoded?.type === "ProjectV2SingleSelectField"
		? rowIdOfNodeKey(decoded.key)
		: null;
}

/** The project a write names: unreadable is NOT_FOUND, someone else's is FORBIDDEN. */
async function writableProject(
	ctx: GraphQLContext,
	projectId: string,
): Promise<ProjectNode> {
	const id = projectRowIdOf(projectId);
	const project =
		id === null ? null : await findReadableProjectById(id, ctx.caller.userId);
	if (!project) throw nodeNotFound(projectId);
	if (!projectAccess(project, ctx.caller.userId).canWrite)
		throw forbidden("You do not have permission to write to this project");
	const owner = await loadUser(ctx, project.ownerId);
	if (!owner) throw new Error("Project owner missing");
	return projectNode(project, owner.username);
}

async function readableProjectItem(
	ctx: GraphQLContext,
	itemId: string,
): Promise<ProjectItemWithRepo> {
	const id = itemRowIdOf(itemId);
	const item =
		id === null ? null : await findReadableProjectItem(id, ctx.caller.userId);
	if (!item) throw nodeNotFound(itemId);
	return item;
}

async function reloadItemNode(ctx: GraphQLContext, itemId: number) {
	const item = await findReadableProjectItem(itemId, ctx.caller.userId);
	if (!item) throw new Error("Project item missing after a mutation");
	return itemNode(item);
}

async function createProjectMutation(
	input: CreateProjectV2Input,
	ctx: GraphQLContext,
) {
	const owner = await loadUser(ctx, ctx.caller.userId);
	if (!owner) throw new Error("Authenticated user missing");
	const decoded = decodeNodeId(input.ownerId);
	if (decoded?.type !== "User" || decoded.key !== String(owner.apiId))
		throw nodeNotFound(input.ownerId);
	if (input.repositoryId != null)
		throw unprocessable("A project cannot be linked to a repository yet");
	const project = await withProjectErrors(() =>
		createProjectForUser(owner.id, { title: input.title }),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		projectV2: projectNode(project, owner.username),
	};
}

async function addProjectItemMutation(
	input: AddProjectV2ItemByIdInput,
	ctx: GraphQLContext,
) {
	const project = await writableProject(ctx, input.projectId);
	const decoded = decodeNodeId(input.contentId);
	const issueId =
		decoded && (decoded.type === "Issue" || decoded.type === "PullRequest")
			? rowIdOfNodeKey(decoded.key)
			: null;
	if (issueId === null) throw nodeNotFound(input.contentId);
	const item = await withProjectErrors(() =>
		addProjectItem(project.row.id, ctx.caller.userId, { issueId }),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		item: await reloadItemNode(ctx, item.id),
	};
}

async function addDraftIssueMutation(
	input: AddProjectV2DraftIssueInput,
	ctx: GraphQLContext,
) {
	const project = await writableProject(ctx, input.projectId);
	const item = await withProjectErrors(() =>
		addProjectItem(project.row.id, ctx.caller.userId, {
			draftTitle: input.title,
			draftBody: input.body ?? null,
		}),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		projectItem: await reloadItemNode(ctx, item.id),
	};
}

async function updateDraftIssueMutation(
	input: UpdateProjectV2DraftIssueInput,
	ctx: GraphQLContext,
) {
	const item = await readableProjectItem(ctx, input.draftIssueId);
	if (item.issueId !== null) throw nodeNotFound(input.draftIssueId);
	const updated = await withProjectErrors(() =>
		updateProjectDraftIssue(item.id, ctx.caller.userId, {
			title: input.title ?? item.draftTitle ?? "",
			...(input.body !== undefined && { body: input.body }),
		}),
	);
	if (!updated) throw nodeNotFound(input.draftIssueId);
	return {
		clientMutationId: input.clientMutationId ?? null,
		draftIssue: draftIssueNode({ ...updated, repoId: null }),
	};
}

/** Exactly one of GitHub's value fields, and never one the field's type rejects. */
function fieldValueInput(value: ProjectV2FieldValue): ProjectFieldValueInput {
	const { text, number, date, singleSelectOptionId } = value;
	if (
		[text, number, date, singleSelectOptionId].filter((entry) => entry != null)
			.length !== 1
	)
		throw unprocessable("A field value sets exactly one value");
	if (text != null) return { type: "TEXT", text };
	if (number != null) return { type: "NUMBER", number };
	if (date != null) {
		if (typeof date !== "string")
			throw unprocessable("A date value must be an ISO 8601 date");
		return { type: "DATE", date };
	}
	if (singleSelectOptionId != null)
		return { type: "SINGLE_SELECT", optionId: singleSelectOptionId };
	throw unprocessable("A field value sets exactly one value");
}

function customFieldDataType(
	dataType: ProjectV2CustomFieldType,
): ProjectFieldDataType {
	if (dataType === "ITERATION" || dataType === "MULTI_SELECT")
		throw unprocessable(`${dataType} fields are not supported`);
	return dataType;
}

async function createFieldMutation(
	input: CreateProjectV2FieldInput,
	ctx: GraphQLContext,
) {
	const project = await writableProject(ctx, input.projectId);
	const field = await withProjectErrors(() =>
		createProjectField(project.row.id, ctx.caller.userId, {
			name: input.name,
			dataType: customFieldDataType(input.dataType),
			options:
				input.singleSelectOptions?.map(({ name, color }) => ({
					name,
					color,
				})) ?? [],
		}),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		projectV2Field: fieldNode(field),
	};
}

/** The item a value write names, refusing one that lives in another project. */
async function itemOfProject(
	ctx: GraphQLContext,
	project: ProjectView,
	itemId: string,
): Promise<ProjectItemWithRepo> {
	const item = await readableProjectItem(ctx, itemId);
	if (item.projectId !== project.id) throw nodeNotFound(itemId);
	return item;
}

async function updateItemFieldValueMutation(
	input: UpdateProjectV2ItemFieldValueInput,
	ctx: GraphQLContext,
) {
	const project = await writableProject(ctx, input.projectId);
	const item = await itemOfProject(ctx, project.row, input.itemId);
	const fieldId = fieldRowIdOf(input.fieldId);
	if (fieldId === null) throw nodeNotFound(input.fieldId);
	const value = fieldValueInput(input.value);
	const written = await withProjectErrors(() =>
		setProjectItemFieldValue(item.id, ctx.caller.userId, fieldId, value),
	);
	if (!written) throw nodeNotFound(input.fieldId);
	return {
		clientMutationId: input.clientMutationId ?? null,
		projectV2Item: await reloadItemNode(ctx, item.id),
	};
}

async function clearItemFieldValueMutation(
	input: ClearProjectV2ItemFieldValueInput,
	ctx: GraphQLContext,
) {
	const project = await writableProject(ctx, input.projectId);
	const item = await itemOfProject(ctx, project.row, input.itemId);
	const fieldId = fieldRowIdOf(input.fieldId);
	if (fieldId === null) throw nodeNotFound(input.fieldId);
	await withProjectErrors(() =>
		clearProjectItemFieldValue(item.id, ctx.caller.userId, fieldId),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		projectV2Item: await reloadItemNode(ctx, item.id),
	};
}

export const projectsResolvers: DomainResolvers = {
	types: {
		Mutation: {
			createProjectV2: (_source, args, ctx) =>
				createProjectMutation(args.input, ctx),
			addProjectV2ItemById: (_source, args, ctx) =>
				addProjectItemMutation(args.input, ctx),
			addProjectV2DraftIssue: (_source, args, ctx) =>
				addDraftIssueMutation(args.input, ctx),
			updateProjectV2DraftIssue: (_source, args, ctx) =>
				updateDraftIssueMutation(args.input, ctx),
			updateProjectV2ItemFieldValue: (_source, args, ctx) =>
				updateItemFieldValueMutation(args.input, ctx),
			clearProjectV2ItemFieldValue: (_source, args, ctx) =>
				clearItemFieldValueMutation(args.input, ctx),
			createProjectV2Field: (_source, args, ctx) =>
				createFieldMutation(args.input, ctx),
		},
		Query: { resource },
		User: {
			projectsV2: (source: UserNode, args, ctx) =>
				projectsForOwner(source.userId, args, ctx),
			// Repository-owned projects are out of scope: only a user owns one.
			projectV2: async (source: UserNode, args: { number: number }, ctx) => {
				const project = await findProjectByNumber(source.userId, args.number);
				if (!project) return null;
				const viewer = ctx.caller.userId;
				if (!project.public && project.ownerId !== viewer) return null;
				const owner = await loadUser(ctx, project.ownerId);
				return owner ? projectNode(project, owner.username) : null;
			},
		},
		Repository: {
			projectsV2: (source: RepositoryNode, args, ctx) =>
				projectsForRepository(source.row.id, args, ctx),
		},
		Issue: {
			projectItems: (source: IssueNode, args, ctx) =>
				threadItemsConnection(
					source.row.id,
					args.includeArchived ?? true,
					args,
					ctx,
				),
		},
		PullRequest: {
			projectItems: (source: PullRequestNode, args, ctx) =>
				threadItemsConnection(
					source.row.id,
					args.includeArchived ?? true,
					args,
					ctx,
				),
		},
		ProjectV2: {
			owner: async (node: ProjectNode, _args, ctx) => {
				const owner = await loadUser(ctx, node.row.ownerId);
				if (!owner) throw new Error("Project owner missing");
				return userNode(owner);
			},
			items: (node: ProjectNode, args, ctx) =>
				projectItemsConnection(node.row.id, args, ctx),
			fields: (node: ProjectNode, args) =>
				countedConnection(args, async (offset, limit) => {
					const { fields, total } = await listProjectFields(node.row.id, {
						offset,
						limit,
					});
					return { items: fields.map(fieldNode), total };
				}),
		},
		ProjectV2Field: {
			project: (node: ProjectFieldNode, _args, ctx) =>
				loadProject(ctx, node.row.projectId),
		},
		ProjectV2SingleSelectField: {
			project: (node: ProjectFieldNode, _args, ctx) =>
				loadProject(ctx, node.row.projectId),
			options: async (
				node: ProjectFieldNode,
				args: { names?: string[] | null } | undefined,
			) => {
				const options = await listFieldOptions(node.row.id);
				const names = args?.names?.map((name) => name.toLowerCase());
				return options
					.filter(
						(option) => !names || names.includes(option.name.toLowerCase()),
					)
					.map((option) => ({
						id: optionIdOf(option),
						name: option.name,
						color: option.color as ProjectV2SingleSelectFieldOptionColor,
						description: "",
						descriptionHTML: "",
						nameHTML: option.name,
					}));
			},
		},
		ProjectV2Item: {
			project: (node: ProjectItemNode, _args, ctx) =>
				loadProject(ctx, node.row.projectId),
			content: async (node: ProjectItemNode, _args, ctx) =>
				node.row.issueId === null
					? draftIssueNode(node.row)
					: ((await loadContent(ctx, node.row.issueId)) ?? null),
			type: (node: ProjectItemNode) =>
				(node.row.issueId === null
					? "DRAFT_ISSUE"
					: node.row.repoId === null
						? "REDACTED"
						: "ISSUE") as ProjectV2ItemType,
			fieldValues: (node: ProjectItemNode, args) =>
				countedConnection(args, async () => {
					const values = await listProjectItemFieldValues(node.row.id);
					return { items: values.map(fieldValueNode), total: values.length };
				}),
			fieldValueByName: async (
				node: ProjectItemNode,
				args: { name: string },
			) => {
				const value = await findProjectItemFieldValueByName(
					node.row.id,
					args.name,
				);
				return value ? fieldValueNode(value) : null;
			},
		},
		ProjectV2ItemFieldTextValue: {
			text: (node: ProjectFieldValueNode) => node.value.valueText,
		},
		ProjectV2ItemFieldNumberValue: {
			number: (node: ProjectFieldValueNode) => node.value.valueNumber,
		},
		ProjectV2ItemFieldDateValue: {
			date: (node: ProjectFieldValueNode) => node.value.valueDate,
		},
		ProjectV2ItemFieldSingleSelectValue: {
			name: async (node: ProjectFieldValueNode) => {
				const options = await listFieldOptions(node.field.row.id);
				return (
					options.find((option) => option.id === node.value.optionId)?.name ??
					null
				);
			},
			optionId: (node: ProjectFieldValueNode) =>
				node.value.optionId === null ? null : String(node.value.optionId),
			color: async (node: ProjectFieldValueNode) => {
				const options = await listFieldOptions(node.field.row.id);
				return (options.find((option) => option.id === node.value.optionId)
					?.color ?? "GRAY") as ProjectV2SingleSelectFieldOptionColor;
			},
		},
	},
	nodes: {
		ProjectV2: loadProjectNode,
		ProjectV2Item: loadItemNode,
		ProjectV2Field: loadField,
		ProjectV2SingleSelectField: loadSingleSelectField,
	},
};
