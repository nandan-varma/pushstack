/**
 * @vitest-environment node
 *
 * The invariants of the authorization-code grant, each checked on its own:
 * the single-use UPDATE, the expiry checks in JS and in SQL, and the token
 * endpoint's rate limits (fail closed). Each test is written so that removing
 * only the invariant it names makes it fail.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { db } = await import("#/db");
const { oauthApps, oauthCodes, tokens } = await import("#/db/app-schema");
const { user } = await import("#/db/schema");
const { sha256Hex } = await import("#/lib/bytes");
const store = await import("../oauth-apps-store");
const { RATE_LIMIT_OAUTH_TOKEN_CLIENT, RATE_LIMIT_OAUTH_TOKEN_IP } =
	await import("../config");
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

function exchangeRequest(
	fields: Record<string, string>,
	headers: Record<string, string> = {},
) {
	return new Request("https://git.test/login/oauth/access_token", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
			...headers,
		},
		body: new URLSearchParams(fields).toString(),
	});
}

async function registerApp() {
	return store.createOAuthApp({
		userId: "alice-id",
		name: "CI bot",
		callbackUrl: CALLBACK,
	});
}

async function approve(app: { id: number }) {
	return store.issueAuthorizationCode({
		appId: app.id,
		userId: "alice-id",
		redirectUri: CALLBACK,
		scopes: ["repo:write"],
	});
}

function exchangeFields(
	app: { clientId: string; clientSecret: string },
	code: string,
) {
	return {
		grant_type: "authorization_code",
		client_id: app.clientId,
		client_secret: app.clientSecret,
		code,
		redirect_uri: CALLBACK,
	};
}

async function exchange(
	app: { clientId: string; clientSecret: string },
	code: string,
) {
	const response = await tokenPost({
		request: exchangeRequest(exchangeFields(app, code)),
	});
	return (await response.json()) as Record<string, string>;
}

const codeRow = async (code: string) =>
	db.query.oauthCodes.findFirst({
		where: { codeHash: await sha256Hex(code) },
	});

beforeEach(async () => {
	await db.execute(sql`delete from rate_limits`);
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

describe("single use of a code", () => {
	it("refuses a replay that a stale read does not see as spent", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const stale = await codeRow(code); // unspent, read before the exchange

		expect((await exchange(app, code)).access_token).toBeDefined();

		// Only the conditional UPDATE can refuse this second exchange: the read
		// below still shows the code as unspent.
		const read = vi
			.spyOn(db.query.oauthCodes, "findFirst")
			.mockResolvedValueOnce(stale);
		const replay = await exchange(app, code);
		read.mockRestore();

		expect(replay).toMatchObject({ error: "bad_verification_code" });
		expect(await db.select().from(tokens)).toHaveLength(1);
	});
});

describe("expiry of a code", () => {
	it("refuses a code the JS check sees as expired, even if the database still has it valid", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const row = await codeRow(code);
		const read = vi
			.spyOn(db.query.oauthCodes, "findFirst")
			.mockResolvedValueOnce({
				...(row as NonNullable<typeof row>),
				expiresAt: new Date(Date.now() - 1000),
			});
		const outcome = await exchange(app, code);
		read.mockRestore();

		expect(outcome).toMatchObject({ error: "bad_verification_code" });
		expect(await db.select().from(tokens)).toHaveLength(0);
	});

	it("refuses a code that expires between the read and the update (SQL check only)", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const stale = await codeRow(code); // still valid when read
		await db
			.update(oauthCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(oauthCodes.codeHash, await sha256Hex(code)));

		const read = vi
			.spyOn(db.query.oauthCodes, "findFirst")
			.mockResolvedValueOnce(stale);
		const outcome = await exchange(app, code);
		read.mockRestore();

		expect(outcome).toMatchObject({ error: "bad_verification_code" });
		expect(await db.select().from(tokens)).toHaveLength(0);
	});

	it("refuses a code at the exact moment it expires", async () => {
		const app = await registerApp();
		const code = await approve(app);
		await db
			.update(oauthCodes)
			.set({ expiresAt: new Date() })
			.where(eq(oauthCodes.codeHash, await sha256Hex(code)));
		expect(await exchange(app, code)).toMatchObject({
			error: "bad_verification_code",
		});
	});
});

describe("token endpoint rate limits", () => {
	it("refuses an exchange once the caller's IP bucket is spent, before the secret is checked", async () => {
		const app = await registerApp();
		await db.execute(sql`
			insert into rate_limits (key, count, window_started_at)
			values ('gh:oauth-token-ip:ip:9.9.9.9', ${RATE_LIMIT_OAUTH_TOKEN_IP}, now())
		`);
		const response = await tokenPost({
			request: exchangeRequest(exchangeFields(app, "0".repeat(40)), {
				"x-forwarded-for": "9.9.9.9",
			}),
		});
		expect(response.status).toBe(429);
		expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
	});

	it("refuses an exchange once the client id's bucket is spent, from any address", async () => {
		const app = await registerApp();
		await db.execute(sql`
			insert into rate_limits (key, count, window_started_at)
			values (${`gh:oauth-token-client:ip:${app.clientId}`}, ${RATE_LIMIT_OAUTH_TOKEN_CLIENT}, now())
		`);
		const response = await tokenPost({
			request: exchangeRequest(exchangeFields(app, "0".repeat(40)), {
				"x-forwarded-for": "8.8.8.8",
			}),
		});
		expect(response.status).toBe(429);
	});

	it("fails closed: an exchange the counter cannot record is refused", async () => {
		const app = await registerApp();
		const code = await approve(app);
		const broken = vi
			.spyOn(db, "execute")
			.mockRejectedValue(new Error("database unavailable"));
		try {
			const response = await tokenPost({
				request: exchangeRequest(exchangeFields(app, code)),
			});
			expect(response.status).toBe(429);
		} finally {
			broken.mockRestore();
		}
		expect(await db.select().from(tokens)).toHaveLength(0);
	});
});

describe("unknown client and pruning", () => {
	it("refuses an unknown client id with the same error as a wrong secret", async () => {
		const app = await registerApp();
		const code = await approve(app);
		expect(
			await exchange(
				{ clientId: "Iv1.0000000000000000", clientSecret: "x" },
				code,
			),
		).toMatchObject({ error: "incorrect_client_credentials" });
	});

	it("drops expired codes when a new code is issued", async () => {
		const app = await registerApp();
		const stale = await approve(app);
		await db
			.update(oauthCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(oauthCodes.codeHash, await sha256Hex(stale)));
		await approve(app);
		expect(await codeRow(stale)).toBeUndefined();
	});
});
