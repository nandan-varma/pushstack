import { drizzle } from "drizzle-orm/d1";
import { isPerfLogEnabled } from "#/lib/perf-log";
import { env } from "#/server/env";
import { perfNote } from "#/server/perf-log";
import { relations } from "./relations";

// SQL text (never parameters — they can carry user data) as notes in the
// current request's perf tree; see src/server/perf-log.ts.
const logger = isPerfLogEnabled()
	? { logQuery: (query: string) => perfNote(`sql ${query}`) }
	: undefined;

// D1: a binding, not a connection, so it is safe at module scope and shared by
// every request an isolate serves.
export const db = drizzle(env.DB, { relations, logger });
