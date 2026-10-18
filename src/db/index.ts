import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { isPerfLogEnabled } from "#/lib/perf-log";
import { perfNote } from "#/server/perf-log";
import * as appSchema from "./app-schema";
import * as authSchema from "./schema";

const schema = { ...authSchema, ...appSchema };

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL environment variable is not set");
}

// Neon's HTTP driver: one stateless HTTPS round trip per query, no pool to
// manage across serverless invocations.
export const db = drizzle(neon(process.env.DATABASE_URL), {
	schema,
	// SQL text (never parameters — they can carry user data) as notes in the
	// current request's perf tree; see src/server/perf-log.ts.
	logger: isPerfLogEnabled()
		? { logQuery: (query) => perfNote(`sql ${query}`) }
		: undefined,
});
