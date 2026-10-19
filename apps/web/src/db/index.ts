import { createRequire } from "node:module";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { isPerfLogEnabled } from "#/lib/perf-log";
import { perfNote } from "#/server/perf-log";
import * as appSchema from "./app-schema";
import * as authSchema from "./schema";

const schema = { ...authSchema, ...appSchema };

// SQL text (never parameters — they can carry user data) as notes in the
// current request's perf tree; see src/server/perf-log.ts.
const logger = isPerfLogEnabled()
	? { logQuery: (query: string) => perfNote(`sql ${query}`) }
	: undefined;

/**
 * `pnpm dev:local` (PUSHSTACK_LOCAL_DIR): an on-disk pglite database whose
 * schema scripts/dev-local.ts pushed before the server started. pglite is a
 * dev dependency, so it's loaded with `require` here rather than imported —
 * it never reaches the production bundle.
 */
function createLocalDb(dir: string) {
	if (process.env.NODE_ENV === "production") {
		throw new Error("PUSHSTACK_LOCAL_DIR is for local development only");
	}
	const require = createRequire(import.meta.url);
	const { PGlite } = require("@electric-sql/pglite");
	const { drizzle: drizzlePglite } = require("drizzle-orm/pglite");
	return drizzlePglite(new PGlite(path.join(dir, "db")), {
		schema,
		logger,
	}) as unknown as ReturnType<typeof createNeonDb>;
}

// Neon's HTTP driver: one stateless HTTPS round trip per query, no pool to
// manage across serverless invocations.
function createNeonDb() {
	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL environment variable is not set");
	}
	return drizzle(neon(process.env.DATABASE_URL), { schema, logger });
}

export const db = process.env.PUSHSTACK_LOCAL_DIR
	? createLocalDb(process.env.PUSHSTACK_LOCAL_DIR)
	: createNeonDb();
