/**
 * @vitest-environment node
 *
 * The webhooks settings page's server functions: a collaborator without admin
 * is refused, editing without a secret keeps the stored one, and the explicit
 * "remove secret" clears it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { db } = await import("#/db");
const { repositories, repositoryCollaborators } = await import(
	"#/db/app-schema"
);
const { findWebhook } = await import("../webhook-store");
const { deleteRepoWebhook, saveRepoWebhook } = await import("../webhooks");

let repoId: number;

const hookData = (extra: Record<string, unknown> = {}) => ({
	repoId,
	hookId: null,
	url: "https://example.com/hook",
	contentType: "json" as const,
	events: ["push"] as const,
	active: true,
	...extra,
});

beforeAll(async () => {
	signIn(users.alice);
	const [repo] = await db
		.insert(repositories)
		.values({ ownerId: users.alice.id, name: "project" })
		.returning();
	if (!repo) throw new Error("Repository insert returned no row");
	repoId = repo.id;
	await db.insert(repositoryCollaborators).values({
		repoId,
		userId: users.bob.id,
		role: "read",
	});
});

describe("webhook settings access", () => {
	it("refuses a read-only collaborator's create and delete", async () => {
		signIn(users.bob);
		await expect(
			saveRepoWebhook({ data: hookData() as never }),
		).rejects.toThrow(/admin rights/);
		signIn(users.alice);
		const hook = await saveRepoWebhook({ data: hookData() as never });
		signIn(users.bob);
		await expect(
			deleteRepoWebhook({ data: { repoId, hookId: hook.id } }),
		).rejects.toThrow(/admin rights/);
		const still = await findWebhook(repoId, hook.id);
		expect(still).not.toBeNull();
	});
});

describe("webhook settings writes", () => {
	it("keeps a stored secret when an edit does not send one", async () => {
		signIn(users.alice);
		const created = await saveRepoWebhook({
			data: hookData({ secret: "s3cret" }) as never,
		});
		const stored = await findWebhook(repoId, created.id);
		expect(stored?.secretSealed).not.toBeNull();

		await saveRepoWebhook({
			data: hookData({
				hookId: created.id,
				url: "https://example.com/edited",
			}) as never,
		});
		const edited = await findWebhook(repoId, created.id);
		expect(edited?.secretSealed).toBe(stored?.secretSealed);
		expect(edited?.url).toBe("https://example.com/edited");
	});

	it("clears the secret when the form removes it", async () => {
		signIn(users.alice);
		const created = await saveRepoWebhook({
			data: hookData({ secret: "s3cret" }) as never,
		});
		await saveRepoWebhook({
			data: hookData({ hookId: created.id, secret: null }) as never,
		});
		expect((await findWebhook(repoId, created.id))?.secretSealed).toBeNull();
	});

	it("refuses a non-https payload URL", async () => {
		signIn(users.alice);
		await expect(
			saveRepoWebhook({
				data: hookData({ url: "http://example.com/hook" }) as never,
			}),
		).rejects.toThrow();
	});
});
