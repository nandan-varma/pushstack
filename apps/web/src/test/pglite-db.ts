/**
 * An in-memory Postgres (pglite) with the app's real schema pushed, for
 * tests that run real queries. Use from a `vi.mock("#/db", …)` factory:
 *   vi.mock("#/db", async () => ({ db: await (await import("<relative path to src/test/pglite-db>")).createTestDb() }));
 */
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api-postgres";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "#/db/app-schema";
import { relations } from "#/db/relations";
import * as authSchema from "#/db/schema";

const schema = { ...authSchema, ...appSchema };

export async function createTestDb() {
	const db = drizzle({ client: new PGlite(), relations });
	const { apply } = await pushSchema(schema, db);
	await apply();
	return db;
}
