/**
 * @vitest-environment node
 *
 * Request limits for /api/v3 and /api/git: GitHub's X-RateLimit-* headers,
 * the 403 body, per-user vs per-IP keying, window rollover, fail-open, and
 * GET /rate_limit. The real dispatcher and git handler over pglite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	process.env.RATE_LIMIT_API_ANONYMOUS = "3";
	process.env.RATE_LIMIT_API_AUTHENTICATED = "4";
	process.env.RATE_LIMIT_API_WRITE = "2";
	process.env.RATE_LIMIT_GIT_READ_ANONYMOUS = "2";
	process.env.RATE_LIMIT_GIT_READ_AUTHENTICATED = "3";
	process.env.RATE_LIMIT_GIT_WRITE = "1";
});
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const { handleApiRequest } = await import("../api");
const { serveGitRequest } = await import("../git-http");
const { createRepository } = await import("../repositories");
const { db } = await import("../../db");
const { sql } = await import("drizzle-orm");
const { mintToken } = await import("../../test/api-client");
const perfLog = await import("../perf-log");

const users = await createUsers("alice", "bob");
const API = "http://localhost:3000/api/v3";
const GIT = "http://localhost:3000/api/git";

let alice: string;
let bob: string;

function api(
	path: string,
	init: RequestInit & { ip?: string; token?: string } = {},
) {
	const headers = new Headers(init.headers);
	if (init.ip) headers.set("x-forwarded-for", `${init.ip}, 10.0.0.1`);
	if (init.token) headers.set("authorization", `token ${init.token}`);
	return handleApiRequest(new Request(`${API}${path}`, { ...init, headers }));
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	signIn(users.alice);
	await createRepository({ data: { name: "pub", visibility: "public" } });
});

beforeEach(async () => {
	await db.execute(sql`delete from rate_limits`);
});

describe("/api/v3 limits", () => {
	it("sends GitHub's headers on every response and counts down", async () => {
		const first = await api("/users/alice", { ip: "1.1.1.1" });
		expect(first.status).toBe(200);
		expect(first.headers.get("x-ratelimit-limit")).toBe("3");
		expect(first.headers.get("x-ratelimit-remaining")).toBe("2");
		expect(first.headers.get("x-ratelimit-used")).toBe("1");
		expect(first.headers.get("x-ratelimit-resource")).toBe("core");
		const reset = Number(first.headers.get("x-ratelimit-reset"));
		expect(reset).toBeGreaterThan(Date.now() / 1000);

		const missing = await api("/users/nobody", { ip: "1.1.1.1" });
		expect(missing.status).toBe(404);
		expect(missing.headers.get("x-ratelimit-remaining")).toBe("1");
	});

	it("403s an anonymous IP over its limit with GitHub's body", async () => {
		for (let i = 0; i < 3; i++) {
			expect((await api("/users/alice", { ip: "2.2.2.2" })).status).toBe(200);
		}
		const refused = await api("/users/alice", { ip: "2.2.2.2" });
		expect(refused.status).toBe(403);
		expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		const body = await refused.json();
		expect(body.message).toBe("API rate limit exceeded for 2.2.2.2.");
		expect(body.documentation_url).toContain("docs.github.com");
		// Another address is unaffected.
		expect((await api("/users/alice", { ip: "3.3.3.3" })).status).toBe(200);
	});

	it("keys authenticated callers by user, not by shared IP", async () => {
		for (let i = 0; i < 4; i++) {
			expect((await api("/user", { ip: "9.9.9.9", token: alice })).status).toBe(
				200,
			);
		}
		const aliceRefused = await api("/user", { ip: "9.9.9.9", token: alice });
		expect(aliceRefused.status).toBe(403);
		expect((await aliceRefused.json()).message).toBe(
			"API rate limit exceeded for user ID alice-id.",
		);
		const bobOk = await api("/user", { ip: "9.9.9.9", token: bob });
		expect(bobOk.status).toBe(200);
		expect(bobOk.headers.get("x-ratelimit-limit")).toBe("4");
		// The shared IP's anonymous bucket is untouched too.
		expect((await api("/users/alice", { ip: "9.9.9.9" })).status).toBe(200);
	});

	it("gives mutating calls their own per-user bucket", async () => {
		const create = (title: string) =>
			api("/repos/alice/pub/issues", {
				method: "POST",
				token: alice,
				body: JSON.stringify({ title }),
			});
		expect((await create("a")).status).toBe(201);
		const second = await create("b");
		expect(second.status).toBe(201);
		expect(second.headers.get("x-ratelimit-limit")).toBe("2");
		expect((await create("c")).status).toBe(403);
		// Reads still have budget.
		expect((await api("/user", { token: alice })).status).toBe(200);
	});

	it("starts a new window once the old one has elapsed", async () => {
		for (let i = 0; i < 3; i++) await api("/users/alice", { ip: "4.4.4.4" });
		expect((await api("/users/alice", { ip: "4.4.4.4" })).status).toBe(403);
		await db.execute(
			sql`update rate_limits set window_started_at = now() - interval '2 hours'`,
		);
		const again = await api("/users/alice", { ip: "4.4.4.4" });
		expect(again.status).toBe(200);
		expect(again.headers.get("x-ratelimit-used")).toBe("1");
	});

	it("fails open and logs when the limiter errors", async () => {
		const warn = vi.spyOn(perfLog, "logWarn").mockImplementation(() => {});
		const execute = vi
			.spyOn(db, "execute")
			.mockRejectedValueOnce(new Error("db down"));
		const response = await api("/users/alice", { ip: "5.5.5.5" });
		execute.mockRestore();
		expect(response.status).toBe(200);
		expect(response.headers.get("x-ratelimit-limit")).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			"rate-limit",
			expect.stringContaining("failed"),
			expect.any(Error),
		);
		warn.mockRestore();
	});

	it("GET /rate_limit reports the buckets without counting itself", async () => {
		await api("/users/alice", { ip: "6.6.6.6" });
		for (let i = 0; i < 2; i++) {
			const response = await api("/rate_limit", { ip: "6.6.6.6" });
			const body = await response.json();
			expect(response.status).toBe(200);
			expect(body.resources.core).toMatchObject({
				limit: 3,
				used: 1,
				remaining: 2,
			});
			expect(body.rate).toEqual(body.resources.core);
			expect(body.resources.core.reset).toBeGreaterThan(Date.now() / 1000);
			expect(response.headers.get("x-ratelimit-remaining")).toBe("2");
		}
		const authed = await (await api("/rate_limit", { token: bob })).json();
		expect(authed.resources.core).toMatchObject({ limit: 4, used: 0 });
		expect(authed.resources.core_write.limit).toBe(2);
	});

	it("still answers /rate_limit when the budget is exhausted", async () => {
		for (let i = 0; i < 4; i++) await api("/users/alice", { ip: "7.7.7.7" });
		const response = await api("/rate_limit", { ip: "7.7.7.7" });
		expect(response.status).toBe(200);
		expect((await response.json()).resources.core.remaining).toBe(0);
	});
});

describe("/api/git limits", () => {
	const refs = (headers: Record<string, string> = {}) =>
		serveGitRequest(
			new Request(`${GIT}/alice/pub.git/info/refs?service=git-upload-pack`, {
				headers,
			}),
		);

	it("403s anonymous clones per IP with a plain-text body and headers", async () => {
		const ip = { "x-forwarded-for": "8.8.8.8" };
		expect((await refs(ip)).status).toBe(200);
		const second = await refs(ip);
		expect(second.status).toBe(200);
		expect(second.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(second.headers.get("x-ratelimit-resource")).toBe("git");
		const refused = await refs(ip);
		expect(refused.status).toBe(403);
		expect(refused.headers.get("content-type")).toContain("text/plain");
		expect(refused.headers.get("retry-after")).not.toBeNull();
		expect(await refused.text()).toContain(
			"API rate limit exceeded for 8.8.8.8",
		);
		expect((await refs({ "x-forwarded-for": "8.8.4.4" })).status).toBe(200);
	});

	it("keys authenticated reads by user and meters pushes separately", async () => {
		const basic = (token: string) => ({
			authorization: `Basic ${btoa(`x:${token}`)}`,
			"x-forwarded-for": "8.8.1.1",
		});
		for (let i = 0; i < 3; i++)
			expect((await refs(basic(alice))).status).toBe(200);
		expect((await refs(basic(alice))).status).toBe(403);
		expect((await refs(basic(bob))).status).toBe(200);

		const push = () =>
			serveGitRequest(
				new Request(`${GIT}/alice/pub.git/info/refs?service=git-receive-pack`, {
					headers: basic(alice),
				}),
			);
		expect((await push()).status).toBe(200);
		const refused = await push();
		expect(refused.status).toBe(403);
		expect(refused.headers.get("x-ratelimit-limit")).toBe("1");
	});
});
