/**
 * @vitest-environment node
 *
 * OAuth apps and the authorization-code grant against pglite: registration
 * (the secret is stored only as a hash), the consent lookup, the exchange of a
 * code for a token (single use, client and redirect checked), and revocation.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { db } = await import("#/db");
const { oauthApps, oauthCodes, tokens } = await import("#/db/app-schema");
const { user } = await import("#/db/schema");
const { sha256Hex } = await import("#/lib/bytes");
const store = await import("../oauth-apps-store");
const { authenticateToken } = await import("../git-auth");
const { Route: TokenRoute } = await import(
	"../../routes/login.oauth.access_token"
);

type Handler = (ctx: { request: Request }) => Promise<Response>;
const postOf = (route: { options: object }) =>
	(route.options as { server?: { handlers?: unknown } }).server?.handlers as {
		POST: Handler;
	};
const tokenPost = postOf(TokenRoute).POST;

const CALLBACK = "https://app.example/cb";

function exchangeRequest(fields: Record<string, string>) {
	return new Request("https://git.test/login/oauth/access_token", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
		},
		body: new URLSearchParams(fields).toString(),
	});
}

async function registerApp(name = "CI bot", callbackUrl = CALLBACK) {
	return store.createOAuthApp({ userId: "alice-id", name, callbackUrl });
}

/** Approve a request as alice, the way decideAuthorization does, and return the code. */
async function approve(
	app: { id: number; clientId: string },
	scopes: ("repo:write" | "repo:read")[] = ["repo:write"],
) {
	return store.issueAuthorizationCode({
		appId: app.id,
		userId: "alice-id",
		redirectUri: CALLBACK,
		scopes,
	});
}

async function exchange(
	app: { clientId: string; clientSecret: string },
	code: string,
	redirectUri = CALLBACK,
) {
	const response = await tokenPost({
		request: exchangeRequest({
			grant_type: "authorization_code",
			client_id: app.clientId,
			client_secret: app.clientSecret,
			code,
			redirect_uri: redirectUri,
		}),
	});
	return (await response.json()) as Record<string, string>;
}

beforeEach(async () => {
	await db.delete(tokens);
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
});

describe("OAuth app registration", () => {
	it("stores only the SHA-256 of the client secret and never lists it", async () => {
		const app = await registerApp();
		const [row] = await db
			.select()
			.from(oauthApps)
			.where(eq(oauthApps.id, app.id));
		expect(row?.clientSecretHash).toBe(await sha256Hex(app.clientSecret));
		expect(JSON.stringify(row)).not.toContain(app.clientSecret);

		const listed = await store.listOAuthApps("alice-id");
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain(app.clientSecret);
		expect(Object.keys(listed[0] ?? {})).not.toContain("clientSecretHash");
	});

	it("lists only the caller's apps", async () => {
		await registerApp("mine");
		const now = new Date();
		await db.insert(user).values({
			id: "bob-id",
			name: "bob",
			username: "bob",
			email: "bob@example.com",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		});
		await store.createOAuthApp({
			userId: "bob-id",
			name: "his",
			callbackUrl: CALLBACK,
		});
		expect((await store.listOAuthApps("alice-id")).map((a) => a.name)).toEqual([
			"mine",
		]);
	});
});

describe("authorization request", () => {
	it("accepts the registered redirect URI exactly", async () => {
		const app = await registerApp();
		expect(
			await store.findAuthorizationApp({
				clientId: app.clientId,
				redirectUri: CALLBACK,
			}),
		).toMatchObject({ ok: true, app: { name: "CI bot" } });
	});

	it("refuses any other redirect URI, including a longer path under the callback", async () => {
		const app = await registerApp();
		for (const redirectUri of [
			"https://app.example/cb/extra",
			"https://app.example/cb?x=1",
			"https://evil.example/cb",
		]) {
			expect(
				await store.findAuthorizationApp({
					clientId: app.clientId,
					redirectUri,
				}),
			).toEqual({ ok: false, error: "redirect_uri_mismatch" });
		}
	});

	it("reports an unknown client", async () => {
		expect(
			await store.findAuthorizationApp({
				clientId: "Iv1.0000000000000000",
				redirectUri: CALLBACK,
			}),
		).toEqual({ ok: false, error: "unknown_client" });
	});
});

describe("code exchange", () => {
	it("turns an approved code into a token that authenticates as the user", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const body = await exchange(app, code);
		expect(body).toMatchObject({ token_type: "bearer", scope: "repo" });
		expect(body.access_token?.startsWith("pst_")).toBe(true);
		expect(await authenticateToken(body.access_token ?? "")).toEqual({
			userId: "alice-id",
			scopes: ["repo:write"],
		});
	});

	it("issues a code once: a replay gets bad_verification_code", async () => {
		const app = await registerApp();
		const code = await approve(app);
		expect((await exchange(app, code)).access_token).toBeDefined();
		expect(await exchange(app, code)).toMatchObject({
			error: "bad_verification_code",
		});
	});

	it("yields one token when the same code is exchanged concurrently", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const results = await Promise.all([
			exchange(app, code),
			exchange(app, code),
			exchange(app, code),
		]);
		expect(results.filter((r) => r.access_token)).toHaveLength(1);
		expect(await db.select().from(tokens)).toHaveLength(1);
	});

	it("refuses a wrong secret without spending the code", async () => {
		const app = await registerApp();
		const code = await approve(app);
		expect(
			await exchange({ ...app, clientSecret: "f".repeat(40) }, code),
		).toMatchObject({ error: "incorrect_client_credentials" });
		expect((await exchange(app, code)).access_token).toBeDefined();
	});

	it("refuses a different redirect URI without spending the code", async () => {
		const app = await registerApp();
		const code = await approve(app);
		expect(await exchange(app, code, "https://evil.example/cb")).toMatchObject({
			error: "redirect_uri_mismatch",
		});
		expect((await exchange(app, code)).access_token).toBeDefined();
	});

	it("refuses a code issued to another app", async () => {
		const app = await registerApp("one");
		const other = await registerApp("two");
		const code = await approve(app);
		expect(await exchange(other, code)).toMatchObject({
			error: "bad_verification_code",
		});
	});

	it("refuses an expired code", async () => {
		const app = await registerApp();
		const code = await approve(app);
		await db
			.update(oauthCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(oauthCodes.codeHash, await sha256Hex(code)));
		expect(await exchange(app, code)).toMatchObject({
			error: "bad_verification_code",
		});
	});
});

describe("revocation", () => {
	it("lists the apps holding tokens, and revoking one ends its tokens", async () => {
		const app = await registerApp();
		const token = (await exchange(app, await approve(app))).access_token ?? "";

		const authorized = await store.listAuthorizedApps("alice-id");
		expect(authorized).toMatchObject([
			{ name: "CI bot", clientId: app.clientId, scopes: ["repo:write"] },
		]);

		expect(
			await store.revokeAuthorizedApp({
				userId: "alice-id",
				appId: app.id,
			}),
		).toBe(1);
		expect(await authenticateToken(token)).toBeNull();
		expect(await store.listAuthorizedApps("alice-id")).toEqual([]);
	});

	it("deleting an app revokes its tokens and drops its codes", async () => {
		const app = await registerApp();
		const token = (await exchange(app, await approve(app))).access_token ?? "";
		await approve(app); // a pending code, not yet exchanged

		expect(await store.deleteOAuthApp({ userId: "alice-id", id: app.id })).toBe(
			true,
		);
		expect(await authenticateToken(token)).toBeNull();
		expect(await db.select().from(oauthCodes)).toEqual([]);
	});

	it("will not delete another user's app", async () => {
		const app = await registerApp();
		expect(
			await store.deleteOAuthApp({ userId: "mallory-id", id: app.id }),
		).toBe(false);
		expect(await store.listOAuthApps("alice-id")).toHaveLength(1);
	});
});
