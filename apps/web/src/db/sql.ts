import { sql } from "drizzle-orm";

/**
 * The database's clock in epoch milliseconds, the unit of every timestamp
 * column (`integer({ mode: "timestamp_ms" })`). Use it in raw SQL so one clock
 * (the database's) decides, instead of each Worker isolate's.
 */
export const nowMs = sql<number>`cast(unixepoch('subsec') * 1000 as integer)`;
