/**
 * @vitest-environment node
 *
 * The rate_limits table holds Better Auth's short windows and the request
 * limits' long ones; pruning from one family must not delete the other's
 * live buckets.
 */
import { expect, it, vi } from "vitest";
import { rateLimits } from "#/db/app-schema";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/test-db")).createTestDb(),
}));

const ago = (ms: number) => new Date(Date.now() - ms);

it("a Better Auth consume + prune leaves live gh: buckets alone", async () => {
	const { db } = await import("../../db");
	const { rateLimitStorage } = await import("../rate-limit");
	await db.insert(rateLimits).values([
		{ key: "gh:core:ip:1.1.1.1", count: 5, windowStartedAt: ago(120_000) },
		{
			key: "gh:core:ip:2.2.2.2",
			count: 5,
			windowStartedAt: ago(2 * 60 * 60 * 1000),
		},
		{ key: "1.1.1.1|/sign-in/email", count: 5, windowStartedAt: ago(120_000) },
	]);
	await rateLimitStorage.consume("fresh", { window: 60, max: 3 });
	const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map(
		(row) => row.key,
	);
	expect(keys).toContain("gh:core:ip:1.1.1.1");
	expect(keys).not.toContain("gh:core:ip:2.2.2.2");
	expect(keys).not.toContain("1.1.1.1|/sign-in/email");
	expect(keys).toContain("fresh");
});
