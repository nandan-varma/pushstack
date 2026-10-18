/**
 * Personal access tokens: real queries against in-memory Postgres (pglite).
 * git-auth looks tokens up by the same `hashToken`.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PREFIX } from "#/lib/token-scopes";

vi.mock("@tanstack/react-start", () => import("@/test/server-test-utils"));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const currentUser = vi.hoisted(() => ({ id: "alice-id" }));
vi.mock("../session", () => ({
	getCurrentUser: async () => currentUser,
}));

async function seedUsers() {
	const { db } = await import("../../db");
	const { user } = await import("../../db/schema");
	const { tokens } = await import("../../db/app-schema");
	await db.delete(tokens);
	await db.delete(user);
	const now = new Date();
	await db.insert(user).values(
		["alice", "bob"].map((name) => ({
			id: `${name}-id`,
			name,
			username: name,
			email: `${name}@example.com`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})),
	);
}

describe("personal access tokens", () => {
	beforeEach(async () => {
		currentUser.id = "alice-id";
		await seedUsers();
	});

	it("creates a prefixed token, stores only its hash, and lists it without the value", async () => {
		const { createToken, hashToken, listTokens } = await import("../tokens");
		const { db } = await import("../../db");
		const { tokens } = await import("../../db/app-schema");

		const { token } = await createToken({
			data: { name: "Laptop", scopes: ["repo:read"], lifetimeDays: 30 },
		});
		expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

		const [row] = await db.select().from(tokens);
		expect(row?.tokenHash).toBe(await hashToken(token));
		expect(JSON.stringify(row)).not.toContain(token);
		const days =
			((row?.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
		expect(Math.round(days)).toBe(30);

		const listed = await listTokens();
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ name: "Laptop", scopes: ["repo:read"] });
		expect(Object.keys(listed[0] ?? {})).not.toContain("tokenHash");
	});

	it("supports tokens that never expire", async () => {
		const { createToken, listTokens } = await import("../tokens");
		await createToken({
			data: { name: "CI", scopes: ["repo:write"], lifetimeDays: null },
		});
		const [listed] = await listTokens();
		expect(listed?.expiresAt).toBeNull();
	});

	it("rejects a token without scopes", async () => {
		const { createToken } = await import("../tokens");
		await expect(
			createToken({ data: { name: "x", scopes: [], lifetimeDays: 7 } }),
		).rejects.toThrow();
	});

	it("only lists and revokes the caller's own tokens", async () => {
		const { createToken, listTokens, revokeToken } = await import("../tokens");
		const { db } = await import("../../db");
		const { tokens } = await import("../../db/app-schema");

		const { id } = await createToken({
			data: { name: "alice's", scopes: ["repo:read"], lifetimeDays: 7 },
		});

		currentUser.id = "bob-id";
		expect(await listTokens()).toEqual([]);
		await revokeToken({ data: { id: id as number } });
		expect(await db.select().from(tokens)).toHaveLength(1);

		currentUser.id = "alice-id";
		await revokeToken({ data: { id: id as number } });
		expect(
			await db
				.select()
				.from(tokens)
				.where(eq(tokens.id, id as number)),
		).toEqual([]);
	});
});
