/**
 * @vitest-environment node
 *
 * The consent decision (`decideAuthorization`) driven as a server function:
 * a request from another site, or one with no Origin, is refused and issues
 * no code. Removing the Origin check makes the cross-site test fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
	request: new Request("https://git.test/_serverFn/decide"),
}));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => http.request,
}));
vi.mock("#/server/session", () =>
	import("../../test/app-harness").then((h) => h.sessionModule),
);

const { db } = await import("#/db");
const { oauthApps, oauthCodes } = await import("#/db/app-schema");
const { user } = await import("#/db/schema");
const { signIn } = await import("../../test/app-harness");
const store = await import("../oauth-apps-store");
const { decideAuthorization } = await import("../oauth-apps");

const CALLBACK = "https://app.example/cb";
const SITE = "https://git.test";

async function requestFrom(origin: string | null) {
	const headers: Record<string, string> = {};
	if (origin !== null) headers.origin = origin;
	http.request = new Request(`${SITE}/_serverFn/decide`, {
		method: "POST",
		headers,
	});
	const app = await store.createOAuthApp({
		userId: "alice-id",
		name: "CI bot",
		callbackUrl: CALLBACK,
	});
	return app;
}

beforeEach(async () => {
	await db.delete(oauthCodes);
	await db.delete(oauthApps);
	await db.delete(user);
	const now = new Date();
	await db.insert(user).values({
		id: "alice-id",
		name: "alice",
		username: "alice",
		email: "alice@example.com",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	signIn({
		id: "alice-id",
		username: "alice",
		name: "alice",
		email: "alice@example.com",
	});
});

describe("consent decision from another site", () => {
	it("refuses a decision posted from another origin and issues no code", async () => {
		const app = await requestFrom("https://evil.example");
		const attempt = decideAuthorization({
			data: {
				client_id: app.clientId,
				redirect_uri: CALLBACK,
				scope: "repo",
				state: "xyz",
				approve: true,
			},
		});
		await expect(attempt).rejects.toThrow(/must come from this site/);
		expect(await db.select().from(oauthCodes)).toHaveLength(0);
	});

	it("refuses a decision with no Origin header", async () => {
		const app = await requestFrom(null);
		await expect(
			decideAuthorization({
				data: {
					client_id: app.clientId,
					redirect_uri: CALLBACK,
					scope: "repo",
					state: "",
					approve: true,
				},
			}),
		).rejects.toThrow(/must come from this site/);
		expect(await db.select().from(oauthCodes)).toHaveLength(0);
	});

	it("accepts a same-origin approval and redirects with a code and the state", async () => {
		const app = await requestFrom(SITE);
		const { redirectTo } = await decideAuthorization({
			data: {
				client_id: app.clientId,
				redirect_uri: CALLBACK,
				scope: "repo",
				state: "xyz",
				approve: true,
			},
		});
		const target = new URL(redirectTo);
		expect(target.origin + target.pathname).toBe(CALLBACK);
		expect(target.searchParams.get("state")).toBe("xyz");
		expect(target.searchParams.get("code")).toMatch(/^[0-9a-f]{40}$/);
		expect(await db.select().from(oauthCodes)).toHaveLength(1);
	});

	it("never redirects anywhere but the registered callback, even when asked to", async () => {
		const app = await requestFrom(SITE);
		await expect(
			decideAuthorization({
				data: {
					client_id: app.clientId,
					redirect_uri: "https://evil.example/cb",
					scope: "repo",
					state: "",
					approve: false,
				},
			}),
		).rejects.toThrow(/not valid/);
	});
});
