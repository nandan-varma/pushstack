/**
 * `pnpm db:push`'s follow-up. Standalone on purpose: it must run under tsx
 * without the app's server modules (src/server/perf-log.ts reads
 * `import.meta.env`, which tsx does not provide).
 */
import { config } from "dotenv";
import { Client } from "pg";
import { BACKFILL_LOGINS_SQL } from "./backfill-logins-sql";

config({ path: [".env.local", ".env"] });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
	await client.query(BACKFILL_LOGINS_SQL);
} finally {
	await client.end();
}
