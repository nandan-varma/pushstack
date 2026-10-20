/**
 * An in-memory Postgres (pglite) holding the app's real schema, loaded from the
 * template `globalSetup` built once for the whole run (see
 * test-db-template.ts). Every call loads its own instance from that template,
 * so each test file starts from an empty database. Use from a
 * `vi.mock("#/db", …)` factory:
 *   vi.mock("#/db", async () => ({ db: await (await import("<relative path to src/test/pglite-db>")).createTestDb() }));
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { relations } from "#/db/relations";
import { loadTestTemplate } from "./test-db-template";

// One read per worker process; every instance is built from the same bytes.
let template: Promise<Blob> | undefined;

export async function createTestDb() {
	template ??= loadTestTemplate().then((bytes) => new Blob([bytes]));
	return drizzle({
		client: new PGlite({ loadDataDir: await template }),
		relations,
	});
}
