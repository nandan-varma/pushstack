/**
 * An in-memory Postgres (pglite) with the app's real schema pushed, for
 * tests that run real queries. Use from a `vi.mock("#/db", …)` factory:
 *   vi.mock("#/db", async () => ({ db: await (await import("<relative path to src/test/pglite-db>")).createTestDb() }));
 */
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "#/db/app-schema";
import * as authSchema from "#/db/schema";

const schema = { ...authSchema, ...appSchema };

export async function createTestDb() {
	const db = drizzle(new PGlite(), { schema });
	const { apply } = await pushSchema(
		schema as unknown as Record<string, unknown>,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();
	return db;
}
