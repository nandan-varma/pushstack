/**
 * @vitest-environment node
 *
 * The `db:push` login backfill: one idempotent statement, so a fresh push and
 * a repeated one leave exactly one registry row per username.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { BACKFILL_LOGINS_SQL } = await import(
	"../../../scripts/backfill-logins-sql"
);
const { db } = await import("#/db");
const { logins } = await import("../../db/app-schema");
const { user } = await import("../../db/schema");

describe("backfilling logins", () => {
	it("records every username, and a second run adds nothing", async () => {
		const now = new Date();
		await db.insert(user).values({
			id: "u1",
			username: "alice",
			name: "Alice",
			email: "alice@example.com",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		});
		await db.execute(BACKFILL_LOGINS_SQL);
		await db.execute(BACKFILL_LOGINS_SQL);
		const rows = await db.select().from(logins);
		expect(rows).toEqual([
			expect.objectContaining({
				login: "alice",
				kind: "user",
				refId: "u1",
			}),
		]);
	});
});
