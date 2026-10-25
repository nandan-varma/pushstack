/**
 * @vitest-environment node
 *
 * The approval page's server functions (`getDeviceAuthorization`,
 * `decideDeviceAuthorization`) against pglite: every user-code attempt is
 * counted per signed-in user and per client IP, a refusal is a 429 with
 * Retry-After, and an uncountable attempt is refused (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
	request: new Request("https://git.test/login/device", {
		headers: { "x-forwarded-for": "9.9.9.9" },
	}),
	status: undefined as number | undefined,
	headers: {} as Record<string, string>,
}));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => http.request,
	setResponseStatus: (status: number) => {
		http.status = status;
	},
	setResponseHeader: (name: string, value: string) => {
		http.headers[name] = value;
	},
}));
vi.mock("#/server/session", () =>
	import("../../test/app-harness").then((h) => h.sessionModule),
);

const { db } = await import("#/db");
const { sql } = await import("drizzle-orm");
const { signIn } = await import("../../test/app-harness");
const { RATE_LIMIT_DEVICE_USER_CODE_USER, RATE_LIMIT_DEVICE_USER_CODE_IP } =
	await import("../config");
const { getDeviceAuthorization, decideDeviceAuthorization } = await import(
	"../device-flow"
);

const user = (id: string) => ({
	id,
	username: id,
	name: id,
	email: `${id}@example.com`,
});

const lookup = (userCode = "BCDF-MGLX") =>
	getDeviceAuthorization({ data: { userCode } });

beforeEach(async () => {
	await db.execute(sql`delete from rate_limits`);
	http.status = undefined;
	http.headers = {};
	http.request = new Request("https://git.test/login/device", {
		headers: { "x-forwarded-for": "9.9.9.9" },
	});
	signIn(user("alice-id"));
});

describe("user-code attempt metering", () => {
	it("answers a lookup under the per-user limit with no refusal", async () => {
		await expect(lookup()).resolves.toBeNull();
		expect(http.status).toBeUndefined();
	});

	it("refuses lookups past the per-user limit with 429 and Retry-After", async () => {
		for (let i = 0; i < RATE_LIMIT_DEVICE_USER_CODE_USER; i++) {
			await lookup();
		}
		await expect(lookup()).rejects.toThrow(/Too many code attempts/);
		expect(http.status).toBe(429);
		expect(Number(http.headers["Retry-After"])).toBeGreaterThan(0);
	});

	it("counts decisions too, so approving or denying cannot be used to guess", async () => {
		for (let i = 0; i < RATE_LIMIT_DEVICE_USER_CODE_USER; i++) {
			await decideDeviceAuthorization({
				data: { userCode: "BCDF-MGLX", approve: true },
			}).catch(() => undefined); // unknown code: the attempt still counts
		}
		await expect(
			decideDeviceAuthorization({
				data: { userCode: "BCDF-MGLX", approve: true },
			}),
		).rejects.toThrow(/Too many code attempts/);
		expect(http.status).toBe(429);
	});

	it("refuses a new user from an address whose per-IP limit is spent", async () => {
		// Three accounts, each under its own limit, together spend the IP limit.
		const accounts = ["u1", "u2", "u3"];
		for (let i = 0; i < RATE_LIMIT_DEVICE_USER_CODE_IP; i++) {
			signIn(user(accounts[i % accounts.length] as string));
			await lookup();
		}
		signIn(user("u4"));
		await expect(lookup()).rejects.toThrow(/Too many code attempts/);
		expect(http.status).toBe(429);
	});

	it("fails closed: an attempt that cannot be counted is refused", async () => {
		const broken = vi
			.spyOn(db, "execute")
			.mockRejectedValue(new Error("database unavailable"));
		try {
			await expect(lookup()).rejects.toThrow(/Too many code attempts/);
			expect(http.status).toBe(429);
		} finally {
			broken.mockRestore();
		}
	});
});
