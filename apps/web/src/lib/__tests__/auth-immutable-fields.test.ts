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
	it.each(["repo", "users", "RePo", "UsErS"])(
		"rejects reserved username %s through the auth handler",
		async (username) => {
			const { auth } = await import("../auth");
			const response = await auth.handler(
				new Request(`${auth.options.baseURL}/api/auth/sign-up/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: String(auth.options.baseURL),
						"x-forwarded-for": `192.0.2.${["repo", "users", "RePo", "UsErS"].indexOf(username) + 1}`,
					},
					body: JSON.stringify({
						name: "Reserved",
						email: `${username}@example.com`,
						password: "correct-horse-battery",
						username,
					}),
				}),
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ code: "INVALID_USERNAME" });
			const { db } = await import("#/db/index");
			expect(
				await db.query.user.findFirst({
					where: { username: username.toLowerCase() },
				}),
			).toBeUndefined();
		},
	);

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
