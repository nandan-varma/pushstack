// @vitest-environment node
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/test-db";
import { repositories } from "../app-schema";
import { inList, notInList } from "../in-list";
import { user } from "../schema";

const db = await createTestDb();

const owner = {
	id: "owner-1",
	name: "Owner",
	email: "owner@example.com",
	emailVerified: true,
	username: "owner",
	createdAt: new Date(0),
	updatedAt: new Date(0),
};

describe("inList", () => {
	it("matches rows whose column is in the list, past D1's 100 parameter limit", async () => {
		await db.insert(user).values(owner);
		const rows = Array.from({ length: 250 }, (_, i) => ({
			ownerId: owner.id,
			name: `repo-${i}`,
		}));
		for (let i = 0; i < rows.length; i += 5) {
			await db.insert(repositories).values(rows.slice(i, i + 5));
		}
		const wanted = rows.slice(0, 240).map((row) => row.name);

		const found = await db
			.select({ name: repositories.name })
			.from(repositories)
			.where(inList(repositories.name, wanted));
		expect(found).toHaveLength(240);

		const rest = await db
			.select({ name: repositories.name })
			.from(repositories)
			.where(notInList(repositories.name, wanted));
		expect(rest.map((row) => row.name).sort()).toEqual(
			rows
				.slice(240)
				.map((row) => row.name)
				.sort(),
		);
	});

	it("matches nothing for an empty list and everything for its negation", async () => {
		expect(
			await db
				.select({ n: sql<number>`1` })
				.from(user)
				.where(inList(user.id, [])),
		).toHaveLength(0);
		expect(
			await db
				.select({ n: sql<number>`1` })
				.from(user)
				.where(notInList(user.id, [])),
		).toHaveLength(1);
	});

	it("applies to expressions, numbers and mixed filters", async () => {
		const [row] = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(inList(sql`lower(${repositories.name})`, ["repo-7"]));
		expect(row).toBeDefined();
		const byId = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(inList(repositories.id, row ? [row.id] : []));
		expect(byId).toHaveLength(1);
	});
});
