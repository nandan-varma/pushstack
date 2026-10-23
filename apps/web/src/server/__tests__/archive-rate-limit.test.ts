/**
 * @vitest-environment node
 *
 * The archive routes are metered like the REST API: anonymous callers by
 * client IP, with GitHub's 403 and X-RateLimit headers once exhausted.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	process.env.RATE_LIMIT_API_ANONYMOUS = "2";
});
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const { createRepository } = await import("../repositories");
const { serveArchive } = await import("../archive");
const { db } = await import("../../db");
const { sql } = await import("drizzle-orm");
const { resetRateLimitMemory } = await import("../rate-limit");

const users = await createUsers("alice");

const get = (ip: string) =>
	serveArchive(
		new Request("http://localhost:3000/alice/pub/archive/main.zip", {
			headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
		}),
		"alice",
		"pub",
		"main",
		"zip",
	);

beforeAll(async () => {
	signIn(users.alice);
	await createRepository({
		data: { name: "pub", visibility: "public", autoInit: true },
	});
});

beforeEach(async () => {
	signOut();
	await db.execute(sql`delete from rate_limits`);
	resetRateLimitMemory();
});

describe("archive rate limit", () => {
	it("403s an anonymous client past its budget, with rate headers", async () => {
		const first = await get("7.7.7.7");
		expect(first.status).toBe(200);
		await first.arrayBuffer();
		await (await get("7.7.7.7")).arrayBuffer();
		const denied = await get("7.7.7.7");
		expect(denied.status).toBe(403);
		expect(await denied.text()).toContain("API rate limit exceeded");
		expect(denied.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
		// Another client has its own bucket.
		expect((await get("8.8.8.8")).status).toBe(200);
	});
});
