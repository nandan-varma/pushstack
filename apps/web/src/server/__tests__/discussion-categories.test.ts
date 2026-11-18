/**
 * @vitest-environment node
 *
 * Discussion categories: the five GitHub seeds a new repository gets, their
 * slugs and formats, the per-repository cap, and what deleting a category
 * holding discussions does. `has_discussions` over `PATCH /repos` reaches
 * GraphQL's `Repository.hasDiscussionsEnabled`.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, patch, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { discussions, issues } = await import("#/db/app-schema");
const {
	createDiscussionCategory,
	deleteDiscussionCategory,
	listDiscussionCategories,
	updateDiscussionCategory,
} = await import("../discussion-store");
const { claimNextIssueOrPrNumber } = await import("../repository-lookup");

const users = await createUsers("alice");
let token: string;
let repoId: number;

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	const created = await call("/user/repos", post(token, { name: "proj" }));
	expect(created.status).toBe(201);
	repoId = created.body.id;
});

function discussionIn(categoryId: number): Promise<number> {
	return claimNextIssueOrPrNumber(repoId).then(async (number) => {
		const [issue] = await db
			.insert(issues)
			.values({
				repoId,
				number,
				authorId: users.alice.id,
				title: `discussion ${number}`,
			})
			.returning();
		if (!issue) throw new Error("discussion insert returned no row");
		await db.insert(discussions).values({ issueId: issue.id, categoryId });
		return issue.id;
	});
}

async function categoryCount(repo: number): Promise<number> {
	return (await listDiscussionCategories(repo)).length;
}

describe("default discussion categories", () => {
	it("seeds GitHub's five, in order, with Q&A answerable", async () => {
		const categories = await listDiscussionCategories(repoId);
		expect(
			categories.map(({ name, slug, emoji, format }) => ({
				name,
				slug,
				emoji,
				format,
			})),
		).toEqual([
			{ name: "General", slug: "general", emoji: "💬", format: "open" },
			{ name: "Ideas", slug: "ideas", emoji: "💡", format: "open" },
			{ name: "Q&A", slug: "q-a", emoji: "🙏", format: "q_and_a" },
			{
				name: "Announcements",
				slug: "announcements",
				emoji: "📣",
				format: "announcement",
			},
			{
				name: "Show and tell",
				slug: "show-and-tell",
				emoji: "🙌",
				format: "open",
			},
		]);
	});

	it("re-derives the slug when a category is renamed", async () => {
		const [ideas] = (await listDiscussionCategories(repoId)).filter(
			(category) => category.slug === "ideas",
		);
		const updated = await updateDiscussionCategory(repoId, ideas.id, {
			name: "  Feature  Requests ",
		});
		expect(updated).toMatchObject({
			name: "  Feature  Requests ",
			slug: "feature-requests",
		});
		await updateDiscussionCategory(repoId, ideas.id, { name: "Ideas" });
	});
});

describe("the per-repository cap", () => {
	it("refuses the 26th category", async () => {
		const held = await categoryCount(repoId);
		for (let i = held; i < 25; i++) {
			await createDiscussionCategory(repoId, {
				name: `Category ${i}`,
				emoji: "💬",
			});
		}
		expect(await categoryCount(repoId)).toBe(25);
		await expect(
			createDiscussionCategory(repoId, { name: "One too many", emoji: "💬" }),
		).rejects.toThrow(/at most 25/);
	});
});

describe("a category with discussions", () => {
	it("refuses deletion only when it is the last one holding discussions", async () => {
		const fresh = await call("/user/repos", post(token, { name: "moving" }));
		const movingRepoId = fresh.body.id;
		const categories = await listDiscussionCategories(movingRepoId);
		const showAndTell = categories.find(
			(category) => category.slug === "show-and-tell",
		);
		const general = categories.find((category) => category.slug === "general");
		if (!showAndTell || !general) throw new Error("seeded categories missing");
		const discussionId = await discussionIn(showAndTell.id);

		expect(await deleteDiscussionCategory(movingRepoId, showAndTell.id)).toBe(
			true,
		);
		const [row] = await db
			.select({ categoryId: discussions.categoryId })
			.from(discussions)
			.where(eq(discussions.issueId, discussionId));
		expect(row?.categoryId).toBe(general.id);

		for (const category of categories) {
			if (category.id !== general.id && category.id !== showAndTell.id) {
				await deleteDiscussionCategory(movingRepoId, category.id);
			}
		}
		await expect(
			deleteDiscussionCategory(movingRepoId, general.id),
		).rejects.toThrow(/Move the discussions/);
	});
});

describe("PATCH /repos has_discussions", () => {
	it("is reflected by GraphQL's hasDiscussionsEnabled", async () => {
		const before = await graphql(
			token,
			`query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) { hasDiscussionsEnabled }
			}`,
			{ owner: "alice", name: "proj" },
		);
		expect(before.body.data.repository).toEqual({
			hasDiscussionsEnabled: true,
		});

		const patched = await call(
			"/repos/alice/proj",
			patch(token, { has_discussions: false }),
		);
		expect(patched.status).toBe(200);
		expect(patched.body.has_discussions).toBe(false);

		const after = await graphql(
			token,
			`query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) { hasDiscussionsEnabled }
			}`,
			{ owner: "alice", name: "proj" },
		);
		expect(after.body.data.repository).toEqual({
			hasDiscussionsEnabled: false,
		});
	});
});
