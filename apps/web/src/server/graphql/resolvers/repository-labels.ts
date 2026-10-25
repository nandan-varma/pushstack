/**
 * Labels: `Repository.labels` and the `createLabel`, `updateLabel` and
 * `deleteLabel` mutations, over label-store.ts (the same store REST uses).
 * Reads need read access; writes need a `repo:write` token and push access.
 * Label names and colors follow the REST rules (lib/labels.ts schemas,
 * limits.ts caps), so both surfaces accept the same labels.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import { labels } from "#/db/app-schema";
import {
	labelColorSchema,
	labelDescriptionSchema,
	labelNameSchema,
} from "#/lib/labels";
import { MAX_LABEL_SEARCH_CHARS } from "#/lib/limits";
import {
	createRepoLabel,
	DuplicateLabelError,
	deleteRepoLabelById,
	updateRepoLabelById,
} from "../../label-store";
import { getAccessForRepository } from "../../repo-access";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { notFound, unprocessable } from "../errors";
import { decodeNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import type {
	CreateLabelInput,
	DeleteLabelInput,
	LabelOrder,
	RepositoryLabelsArgs,
	UpdateLabelInput,
} from "./generated";
import type { RepositoryNode } from "./repository";
import {
	loadRepositoryById,
	loadRepositoryRow,
	requirePushAccess,
	requireRepoScope,
} from "./repository-write";

const LABEL_NOT_FOUND = (id: string) =>
	notFound(`Could not resolve to a node with the global id of '${id}'`);

/** A label as the schema's `Label` (id, name, color, description). */
function labelNode(row: {
	id: number;
	name: string;
	color: string;
	description: string | null;
}) {
	return {
		id: encodeNodeId("Label", row.id),
		name: row.name,
		color: row.color,
		description: row.description,
	};
}

/** LIKE pattern for a literal search term (`%`, `_` and `\` are escaped). */
const likeContains = (term: string) =>
	`%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * GitHub's label order: CREATED_AT (the default) or NAME, each with a
 * direction. ISSUE_COUNT needs per-label counts this domain does not compute,
 * so it is refused rather than mis-ordered.
 */
function labelOrderBy(order: LabelOrder | null | undefined) {
	const direction = order?.direction === "DESC" ? desc : asc;
	if (order?.field === "ISSUE_COUNT") {
		throw unprocessable("Ordering labels by issue count is not supported yet.");
	}
	return order?.field === "NAME"
		? [direction(sql`lower(${labels.name})`), direction(labels.id)]
		: [direction(labels.createdAt), direction(labels.id)];
}

async function repositoryLabels(
	source: RepositoryNode,
	args: RepositoryLabelsArgs,
) {
	const term = args.query?.trim() ?? "";
	if (term.length > MAX_LABEL_SEARCH_CHARS) {
		throw unprocessable(
			`The label search is too long (maximum is ${MAX_LABEL_SEARCH_CHARS} characters).`,
		);
	}
	const where: SQL | undefined = and(
		eq(labels.repoId, source.row.id),
		term
			? or(
					ilike(labels.name, likeContains(term)),
					ilike(labels.description, likeContains(term)),
				)
			: undefined,
	);
	const [total] = await db.select({ total: count() }).from(labels).where(where);
	return offsetConnection(args, total?.total ?? 0, async (offset, limit) =>
		(
			await db
				.select({
					id: labels.id,
					name: labels.name,
					color: labels.color,
					description: labels.description,
				})
				.from(labels)
				.where(where)
				.orderBy(...labelOrderBy(args.orderBy))
				.offset(offset)
				.limit(limit)
		).map(labelNode),
	);
}

/** A label by id and the caller's access to its repository, or NOT_FOUND. */
async function labelForWrite(ctx: GraphQLContext, labelId: string) {
	const decoded = decodeNodeId(labelId);
	const id = decoded?.type === "Label" ? rowIdOfNodeKey(decoded.key) : null;
	if (id === null) throw LABEL_NOT_FOUND(labelId);
	const [row] = await db
		.select({
			id: labels.id,
			name: labels.name,
			color: labels.color,
			description: labels.description,
			repoId: labels.repoId,
		})
		.from(labels)
		.where(eq(labels.id, id))
		.limit(1);
	if (!row) throw LABEL_NOT_FOUND(labelId);
	const found = await loadRepositoryRow(row.repoId);
	if (!found) throw LABEL_NOT_FOUND(labelId);
	const access = await getAccessForRepository(found.repo, ctx.caller.userId);
	if (!access.canRead) throw LABEL_NOT_FOUND(labelId);
	requirePushAccess(access);
	return { row, repo: found.repo };
}

/** `description: ""` (or null) clears it, as REST does. */
function parseDescription(value: string | null | undefined) {
	if (value == null) return undefined;
	const parsed = labelDescriptionSchema.safeParse(value);
	if (!parsed.success) {
		throw unprocessable(
			`Description ${parsed.error.issues[0]?.message ?? "is invalid"}`,
		);
	}
	return parsed.data;
}

function parseName(value: string) {
	const parsed = labelNameSchema.safeParse(value);
	if (!parsed.success) {
		throw unprocessable(
			`Name ${parsed.error.issues[0]?.message ?? "is invalid"}`,
		);
	}
	return parsed.data;
}

function parseColor(value: string) {
	const parsed = labelColorSchema.safeParse(value);
	if (!parsed.success) {
		throw unprocessable(
			`Color ${parsed.error.issues[0]?.message ?? "is invalid"}`,
		);
	}
	return parsed.data;
}

const duplicate = () => unprocessable("Label already exists");

async function createLabel(input: CreateLabelInput, ctx: GraphQLContext) {
	requireRepoScope(ctx, "createLabel");
	const { repo, access } = await loadRepositoryById(ctx, input.repositoryId);
	requirePushAccess(access);
	const name = parseName(input.name);
	const color = parseColor(input.color);
	const description = parseDescription(input.description);
	try {
		const created = await createRepoLabel(repo.id, {
			name,
			color,
			description,
		});
		return {
			clientMutationId: input.clientMutationId ?? null,
			label: labelNode(created),
		};
	} catch (error) {
		if (error instanceof DuplicateLabelError) throw duplicate();
		throw error;
	}
}

async function updateLabel(input: UpdateLabelInput, ctx: GraphQLContext) {
	requireRepoScope(ctx, "updateLabel");
	const { row, repo } = await labelForWrite(ctx, input.id);
	const name = input.name == null ? undefined : parseName(input.name);
	const color = input.color == null ? undefined : parseColor(input.color);
	const description =
		input.description === undefined
			? undefined
			: (parseDescription(input.description) ?? "");
	try {
		const updated = await updateRepoLabelById(repo.id, row.id, {
			name,
			color,
			description,
		});
		if (!updated) throw LABEL_NOT_FOUND(input.id);
		return {
			clientMutationId: input.clientMutationId ?? null,
			label: labelNode(updated),
		};
	} catch (error) {
		if (error instanceof DuplicateLabelError) throw duplicate();
		throw error;
	}
}

async function deleteLabel(input: DeleteLabelInput, ctx: GraphQLContext) {
	requireRepoScope(ctx, "deleteLabel");
	const { row, repo } = await labelForWrite(ctx, input.id);
	await deleteRepoLabelById(repo.id, row.id);
	return { clientMutationId: input.clientMutationId ?? null };
}

/** Repository fields and the label mutations, merged into repository.ts. */
export const repositoryLabelFields = {
	labels: (source: RepositoryNode, args: RepositoryLabelsArgs) =>
		repositoryLabels(source, args),
};

export const labelMutationResolvers = {
	createLabel: (
		_source: unknown,
		args: { input: CreateLabelInput },
		ctx: GraphQLContext,
	) => createLabel(args.input, ctx),
	updateLabel: (
		_source: unknown,
		args: { input: UpdateLabelInput },
		ctx: GraphQLContext,
	) => updateLabel(args.input, ctx),
	deleteLabel: (
		_source: unknown,
		args: { input: DeleteLabelInput },
		ctx: GraphQLContext,
	) => deleteLabel(args.input, ctx),
};
