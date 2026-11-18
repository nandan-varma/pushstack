/**
 * Discussion categories, shared by the server functions, the REST API and
 * GraphQL. A discussion itself is an `issues` row (see thread-store.ts); this
 * module owns the per-repository categories the discussions are filed under.
 * Callers authorize first; everything here assumes the repository exists.
 */
import { and, asc, count, eq, ne } from "drizzle-orm";
import { db } from "#/db";
import { discussionCategories, discussions } from "#/db/app-schema";
import {
	DEFAULT_DISCUSSION_CATEGORIES,
	type DiscussionCategoryFormat,
	discussionCategorySlug,
} from "#/lib/discussions";
import { MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY } from "#/lib/limits";
import { isUniqueViolation } from "./db-errors";
import {
	assertRepositoryCapacity,
	withRepositoryCapacityLock,
} from "./repository-capacity";

export interface DiscussionCategoryView {
	id: number;
	repoId: number;
	name: string;
	slug: string;
	emoji: string;
	description: string | null;
	format: DiscussionCategoryFormat;
	position: number;
}

export class DuplicateDiscussionCategoryError extends Error {
	constructor() {
		super("A discussion category with this name already exists");
	}
}

/** Refused only for the last category of a repository that still holds discussions. */
export class DiscussionCategoryNotEmptyError extends Error {
	constructor() {
		super("Move the discussions in this category before deleting it");
	}
}

const categoryColumns = {
	id: discussionCategories.id,
	repoId: discussionCategories.repoId,
	name: discussionCategories.name,
	slug: discussionCategories.slug,
	emoji: discussionCategories.emoji,
	description: discussionCategories.description,
	format: discussionCategories.format,
	position: discussionCategories.position,
};

export function assertCategoryCapacity(held: number): void {
	assertRepositoryCapacity(
		held,
		MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY,
		`A repository holds at most ${MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY} discussion categories`,
	);
}

export function listDiscussionCategories(
	repoId: number,
): Promise<DiscussionCategoryView[]> {
	return db
		.select(categoryColumns)
		.from(discussionCategories)
		.where(eq(discussionCategories.repoId, repoId))
		.orderBy(asc(discussionCategories.position), asc(discussionCategories.id));
}

async function countCategories(repoId: number): Promise<number> {
	const [held] = await db
		.select({ total: count() })
		.from(discussionCategories)
		.where(eq(discussionCategories.repoId, repoId));
	return Number(held?.total ?? 0);
}

export async function createDiscussionCategory(
	repoId: number,
	data: {
		name: string;
		emoji: string;
		description?: string;
		format?: DiscussionCategoryFormat;
	},
): Promise<DiscussionCategoryView> {
	return withRepositoryCapacityLock(repoId, async () => {
		assertCategoryCapacity(await countCategories(repoId));
		const [category] = await db
			.insert(discussionCategories)
			.values({
				repoId,
				name: data.name,
				slug: discussionCategorySlug(data.name),
				emoji: data.emoji,
				description: data.description || null,
				format: data.format ?? "open",
			})
			.returning(categoryColumns)
			.catch((error: unknown) => {
				throw isUniqueViolation(error)
					? new DuplicateDiscussionCategoryError()
					: error;
			});
		if (!category)
			throw new Error("Discussion category insert returned no row");
		return category;
	});
}

export async function updateDiscussionCategory(
	repoId: number,
	categoryId: number,
	fields: {
		name?: string;
		emoji?: string;
		description?: string;
		format?: DiscussionCategoryFormat;
	},
): Promise<DiscussionCategoryView | null> {
	const changes = {
		...(fields.name !== undefined && {
			name: fields.name,
			slug: discussionCategorySlug(fields.name),
		}),
		...(fields.emoji !== undefined && { emoji: fields.emoji }),
		...(fields.description !== undefined && {
			description: fields.description || null,
		}),
		...(fields.format !== undefined && { format: fields.format }),
	};
	if (Object.keys(changes).length === 0) {
		const [existing] = await db
			.select(categoryColumns)
			.from(discussionCategories)
			.where(
				and(
					eq(discussionCategories.id, categoryId),
					eq(discussionCategories.repoId, repoId),
				),
			);
		return existing ?? null;
	}
	const [category] = await db
		.update(discussionCategories)
		.set(changes)
		.where(
			and(
				eq(discussionCategories.id, categoryId),
				eq(discussionCategories.repoId, repoId),
			),
		)
		.returning(categoryColumns)
		.catch((error: unknown) => {
			throw isUniqueViolation(error)
				? new DuplicateDiscussionCategoryError()
				: error;
		});
	return category ?? null;
}

/**
 * Delete a category, filing the discussions it still holds under the first
 * remaining category (GitHub moves them to General). Deleting the last
 * category while it holds discussions is refused: a discussion always has one.
 */
export async function deleteDiscussionCategory(
	repoId: number,
	categoryId: number,
): Promise<boolean> {
	const remaining = await db
		.select({ id: discussionCategories.id })
		.from(discussionCategories)
		.where(
			and(
				eq(discussionCategories.repoId, repoId),
				ne(discussionCategories.id, categoryId),
			),
		)
		.orderBy(asc(discussionCategories.position), asc(discussionCategories.id))
		.limit(1);
	const target = remaining[0];
	if (target) {
		await db
			.update(discussions)
			.set({ categoryId: target.id })
			.where(eq(discussions.categoryId, categoryId));
	} else {
		const [held] = await db
			.select({ total: count() })
			.from(discussions)
			.where(eq(discussions.categoryId, categoryId));
		if (Number(held?.total ?? 0) > 0)
			throw new DiscussionCategoryNotEmptyError();
	}
	const deleted = await db
		.delete(discussionCategories)
		.where(
			and(
				eq(discussionCategories.id, categoryId),
				eq(discussionCategories.repoId, repoId),
			),
		)
		.returning({ id: discussionCategories.id });
	return deleted.length > 0;
}

export async function createDefaultDiscussionCategories(
	repoId: number,
): Promise<void> {
	await db.insert(discussionCategories).values(
		DEFAULT_DISCUSSION_CATEGORIES.map((category, position) => ({
			repoId,
			name: category.name,
			slug: discussionCategorySlug(category.name),
			emoji: category.emoji,
			description: category.description,
			format: category.format,
			position,
		})),
	);
}
