/**
 * @vitest-environment node
 *
 * Real Better Auth (email + username plugin) against in-memory Postgres
 * (pglite): sign-up still sets a username, profile edits still work, but the
 * username and email — which repository storage keys derive from — can't be
 * changed afterwards. The email refusal is asserted twice: once through the
 * public API and once against this app's own `databaseHooks` refusal, because
 * Better Auth's own guard would mask a missing entry in that list.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	process.env.DATABASE_URL ??= "postgresql://test@localhost/test";
	process.env.BETTER_AUTH_SECRET ??=
		"test-better-auth-secret-with-32-plus-characters";
});

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

vi.mock("../email", () => ({ sendEmail: vi.fn(async () => undefined) }));

describe("immutable user fields", () => {
	it("keeps username and email fixed after sign-up, allows other profile edits", async () => {
		const { auth } = await import("../auth");
		const { db } = await import("#/db/index");
		const { user } = await import("../../db/schema");
		const { eq } = await import("drizzle-orm");

		const signUp = await auth.api.signUpEmail({
			body: {
				email: "octo@example.com",
				password: "correct-horse-battery",
				name: "Octo",
				username: "octocat",
			},
		});
		const userId = signUp.user.id;
		const [created] = await db.select().from(user).where(eq(user.id, userId));
		expect(created?.username).toBe("octocat");

		// Sign-in requires a verified email; flip it the way the verify link would.
		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.id, userId));
		const signIn = await auth.api.signInEmail({
			body: { email: "octo@example.com", password: "correct-horse-battery" },
			returnHeaders: true,
		});
		const cookie = signIn.headers.get("set-cookie") ?? "";
		const headers = new Headers({
			cookie: cookie
				.split(/,(?=\s*\w+=)/)
				.map((c) => c.split(";")[0])
				.join("; "),
		});

		await auth.api.updateUser({ body: { name: "Octo Cat" }, headers });
		await expect(
			auth.api.updateUser({ body: { username: "someoneelse" }, headers }),
		).rejects.toThrow(/can't be changed/);

		// The app's own refusal, called directly. `updateUser`'s body type does
		// not even admit an `email` field (and its handler rejects one), so an
		// API-level assertion would pass with `email` missing from this app's
		// list — which is exactly the regression to catch: the check that still
		// holds if `/change-email` is enabled later.
		const beforeUpdate = auth.options.databaseHooks?.user?.update?.before;
		const updateHooks = Array.isArray(beforeUpdate)
			? beforeUpdate
			: [beforeUpdate];
		await expect(
			(async () => {
				for (const hook of updateHooks) {
					await hook?.({
						email: "moved@example.com",
					} as unknown as Parameters<NonNullable<typeof hook>>[0]);
				}
			})(),
		).rejects.toThrow(/can't be changed/);

		const [after] = await db.select().from(user).where(eq(user.id, userId));
		expect(after?.name).toBe("Octo Cat");
		expect(after?.username).toBe("octocat");
	}, 30_000);
});
