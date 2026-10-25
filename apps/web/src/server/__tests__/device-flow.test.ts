/**
 * @vitest-environment node
 *
 * The device flow end to end against pglite: the two HTTP endpoints (called
 * through their file routes, as the server runs them), the approval state,
 * and the token each approved poll issues.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { db } = await import("#/db");
const { deviceCodes, tokens } = await import("#/db/app-schema");
const { user } = await import("#/db/schema");
const { sha256Hex } = await import("#/lib/bytes");
const { DEVICE_GRANT_TYPE } = await import("#/lib/device-flow");
const store = await import("../device-flow-store");
const { authenticateToken } = await import("../git-auth");
const { Route: CodeRoute } = await import("../../routes/login.device.code");
const { Route: TokenRoute } = await import(
	"../../routes/login.oauth.access_token"
);

type Handler = (ctx: { request: Request }) => Promise<Response>;
/** A file route's handlers object, typed as the POST handler it carries. */
const postOf = (route: { options: object }) =>
	(route.options as { server?: { handlers?: unknown } }).server?.handlers as {
		POST: Handler;
	};
const startHandler = postOf(CodeRoute).POST;
const pollHandler = postOf(TokenRoute).POST;
const startCode = (request: Request) => startHandler({ request });
const poll = (request: Request) => pollHandler({ request });

function formRequest(
	url: string,
	fields: Record<string, string>,
	accept?: string,
) {
	return new Request(url, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			...(accept ? { accept } : {}),
		},
		body: new URLSearchParams(fields).toString(),
	});
}

async function startLogin(scope = "repo read:org gist") {
	const response = await startCode(
		formRequest(
			"https://git.test/login/device/code",
			{ client_id: "gh-cli", scope },
			"application/json",
		),
	);
	return (await response.json()) as {
		device_code: string;
		user_code: string;
		verification_uri: string;
		expires_in: number;
		interval: number;
	};
}

async function pollOnce(deviceCode: string, clientId = "gh-cli") {
	const response = await poll(
		formRequest(
			"https://git.test/login/oauth/access_token",
			{
				client_id: clientId,
				device_code: deviceCode,
				grant_type: DEVICE_GRANT_TYPE,
			},
			"application/json",
		),
	);
	return {
		status: response.status,
		body: (await response.json()) as Record<string, unknown>,
	};
}

/** Make the next poll count as "not too soon" without sleeping. */
async function allowNextPoll(deviceCode: string) {
	await db
		.update(deviceCodes)
		.set({ lastPolledAt: new Date(0) })
		.where(eq(deviceCodes.deviceCodeHash, await sha256Hex(deviceCode)));
}

describe("device flow", () => {
	beforeEach(async () => {
		await db.delete(tokens);
		await db.delete(deviceCodes);
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

	it("starts a login with GitHub's response shape and a verification URL", async () => {
		const grant = await startLogin();
		expect(grant.device_code).toMatch(/^[0-9a-f]{40}$/);
		expect(grant.user_code).toMatch(
			/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
		);
		expect(grant.verification_uri).toBe("https://git.test/login/device");
		expect(grant.expires_in).toBe(900);
		expect(grant.interval).toBe(5);

		const [row] = await db.select().from(deviceCodes);
		expect(row?.deviceCodeHash).toBe(await sha256Hex(grant.device_code));
		expect(JSON.stringify(row)).not.toContain(grant.device_code);
	});

	it("rejects a missing client_id with GitHub's error", async () => {
		const response = await startCode(
			formRequest("https://git.test/login/device/code", { scope: "repo" }),
		);
		expect(await response.text()).toContain(
			"error=incorrect_client_credentials",
		);
	});

	it("walks pending, slow_down, approval, one token, then used up", async () => {
		const grant = await startLogin();

		expect((await pollOnce(grant.device_code)).body).toMatchObject({
			error: "authorization_pending",
		});

		// Polling again inside the interval is slow_down, and it raises the interval.
		expect(await pollOnce(grant.device_code)).toEqual({
			status: 200,
			body: expect.objectContaining({ error: "slow_down", interval: 10 }),
		});

		await allowNextPoll(grant.device_code);
		expect(
			await store.decideDeviceCode({
				userCode: grant.user_code.toLowerCase(),
				userId: "alice-id",
				approve: true,
			}),
		).toBe(true);

		const issued = await pollOnce(grant.device_code);
		expect(issued.status).toBe(200);
		const token = issued.body.access_token as string;
		expect(token.startsWith("pst_")).toBe(true);
		expect(issued.body).toMatchObject({ token_type: "bearer", scope: "repo" });

		// Only the hash is stored, and the token authenticates like a PAT.
		const [stored] = await db.select().from(tokens);
		expect(stored?.tokenHash).toBe(await sha256Hex(token));
		expect(JSON.stringify(stored)).not.toContain(token);
		expect(await authenticateToken(token)).toEqual({
			userId: "alice-id",
			scopes: ["repo:write"],
		});

		await allowNextPoll(grant.device_code);
		expect((await pollOnce(grant.device_code)).body).toEqual({
			error: "incorrect_device_code",
			error_description: expect.any(String),
			error_uri: expect.stringContaining("error-codes-for-the-device-flow"),
		});
	});

	it("reports access_denied after a denial", async () => {
		const grant = await startLogin();
		await store.decideDeviceCode({
			userCode: grant.user_code,
			userId: "alice-id",
			approve: false,
		});
		await allowNextPoll(grant.device_code);
		expect((await pollOnce(grant.device_code)).body).toMatchObject({
			error: "access_denied",
		});
		const [stored] = await db.select().from(tokens);
		expect(stored).toBeUndefined();
	});

	it("reports expired_token once the code has expired, and refuses to approve it", async () => {
		const grant = await startLogin();
		await db
			.update(deviceCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(
				eq(deviceCodes.deviceCodeHash, await sha256Hex(grant.device_code)),
			);

		expect(
			await store.decideDeviceCode({
				userCode: grant.user_code,
				userId: "alice-id",
				approve: true,
			}),
		).toBe(false);
		expect((await pollOnce(grant.device_code)).body).toMatchObject({
			error: "expired_token",
		});
	});

	it("decides a code only once", async () => {
		const grant = await startLogin();
		const decide = () =>
			store.decideDeviceCode({
				userCode: grant.user_code,
				userId: "alice-id",
				approve: true,
			});
		expect(await decide()).toBe(true);
		expect(await decide()).toBe(false);
	});

	it("binds a device code to its client and the device-code grant", async () => {
		const grant = await startLogin();
		expect(
			(await pollOnce(grant.device_code, "someone-else")).body,
		).toMatchObject({
			error: "incorrect_client_credentials",
		});
		expect((await pollOnce("0".repeat(40))).body).toMatchObject({
			error: "incorrect_device_code",
		});

		const wrongGrant = await poll(
			formRequest(
				"https://git.test/login/oauth/access_token",
				{
					client_id: "gh-cli",
					device_code: grant.device_code,
					grant_type: "password",
				},
				"application/json",
			),
		);
		expect(await wrongGrant.json()).toMatchObject({
			error: "unsupported_grant_type",
		});
	});

	it("issues a token with no repo scope when the request asked for none", async () => {
		const grant = await startLogin("read:org gist");
		await store.decideDeviceCode({
			userCode: grant.user_code,
			userId: "alice-id",
			approve: true,
		});
		await allowNextPoll(grant.device_code);
		const issued = await pollOnce(grant.device_code);
		expect(issued.body).toMatchObject({ scope: "" });
		expect(await authenticateToken(issued.body.access_token as string)).toEqual(
			{
				userId: "alice-id",
				scopes: [],
			},
		);
	});

	it("ignores a user code that is not canonical or not pending", async () => {
		expect(await store.findPendingDeviceCode("not-a-code")).toBeNull();
		const grant = await startLogin();
		expect(
			await store.findPendingDeviceCode(grant.user_code.toLowerCase()),
		).toMatchObject({
			userCode: grant.user_code,
			clientId: "gh-cli",
			scopes: ["repo:write"],
		});
		await store.decideDeviceCode({
			userCode: grant.user_code,
			userId: "alice-id",
			approve: false,
		});
		expect(await store.findPendingDeviceCode(grant.user_code)).toBeNull();
	});
});
