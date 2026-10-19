/**
 * `pnpm dev:local`: run PushStack with no cloud accounts. Git objects live on
 * disk (src/server/local-object-store.ts) and the database is an on-disk
 * pglite (src/db/index.ts), both under `.pushstack-local/` (override with
 * PUSHSTACK_LOCAL_DIR). Emails print to the terminal (src/lib/email.ts).
 *
 * Variables from `.env.local` that would reach real services — R2, Resend,
 * Sentry — are blanked here, so this never touches production even when
 * `.env.local` points at it. Delete `.pushstack-local/` to start over.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "../src/db/app-schema";
import * as authSchema from "../src/db/schema";

const localDir = path.resolve(
	process.env.PUSHSTACK_LOCAL_DIR ?? ".pushstack-local",
);
mkdirSync(localDir, { recursive: true });

// Bring the on-disk database up to the current schema (the same push
// `pnpm db:push` does against Neon), then release it for the dev server.
const client = new PGlite(path.join(localDir, "db"));
const schema = { ...authSchema, ...appSchema };
const { apply, hasDataLoss, warnings } = await pushSchema(
	schema as unknown as Record<string, unknown>,
	drizzle(client, { schema }) as unknown as Parameters<typeof pushSchema>[1],
);
if (hasDataLoss) {
	console.warn(
		`[dev:local] schema change drops data:\n  ${warnings.join("\n  ")}\n` +
			`[dev:local] applying anyway — delete ${localDir} if things look off`,
	);
}
await apply();
await client.close();

const blank = [
	"DATABASE_URL",
	"R2_BUCKET_NAME",
	"R2_ENDPOINT",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"RESEND_API_KEY",
	"VITE_SENTRY_DSN",
	"SENTRY_AUTH_TOKEN",
];
const env: NodeJS.ProcessEnv = {
	...process.env,
	...Object.fromEntries(blank.map((name) => [name, ""])),
	PUSHSTACK_LOCAL_DIR: localDir,
	BETTER_AUTH_URL: "http://localhost:3000",
	BETTER_AUTH_SECRET:
		process.env.BETTER_AUTH_SECRET || "pushstack-local-dev-secret-not-for-production",
};

console.info(`[dev:local] data in ${localDir}`);
const vite = spawn("pnpm", ["exec", "vite", "dev", "--port", "3000"], {
	env,
	stdio: "inherit",
});
vite.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => vite.kill(signal));
}
