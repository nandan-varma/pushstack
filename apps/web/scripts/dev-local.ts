/**
 * `pnpm dev:local`: run PushStack with no cloud accounts. Git objects live on
 * disk (git-fs-s3's FileObjectStore) and the database is an on-disk
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
import { pushSchema } from "drizzle-kit/api-postgres";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "../src/db/app-schema";
import * as authSchema from "../src/db/schema";

const localDir = path.resolve(
	process.env.PUSHSTACK_LOCAL_DIR ?? ".pushstack-local",
);
mkdirSync(localDir, { recursive: true });

const client = new PGlite(path.join(localDir, "db"));
const schema = { ...authSchema, ...appSchema };
const { apply, hints } = await pushSchema(schema, drizzle({ client })).catch(
	(error: unknown) => {
		// drizzle-kit's programmatic push can't ask whether a column or table
		// was renamed or dropped, so an ambiguous change throws an internal
		// "called without a HintsHandler" error. Say what to do instead.
		if (error instanceof Error && error.message.includes("HintsHandler")) {
			console.error(
				`[dev:local] the schema renamed or dropped a column/table that ${localDir} still has, ` +
					"and a non-interactive push can't tell which.\n" +
					`[dev:local] delete ${localDir} (or set PUSHSTACK_LOCAL_DIR to a new directory) to start over.`,
			);
			process.exit(1);
		}
		throw error;
	},
);
if (hints.length > 0) {
	console.warn(
		`[dev:local] schema change notes:\n  ${hints.map(({ hint }) => hint).join("\n  ")}\n` +
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
// `PORT` lets several worktrees run their own local server side by side.
const port = process.env.PORT || "3000";
const env: NodeJS.ProcessEnv = {
	...process.env,
	...Object.fromEntries(blank.map((name) => [name, ""])),
	PUSHSTACK_LOCAL_DIR: localDir,
	BETTER_AUTH_URL: `http://localhost:${port}`,
	BETTER_AUTH_SECRET:
		process.env.BETTER_AUTH_SECRET ||
		"pushstack-local-dev-secret-not-for-production",
};

console.info(`[dev:local] data in ${localDir}`);
const vite = spawn(
	"pnpm",
	["exec", "vite", "dev", "--port", port, "--strictPort"],
	{
		env,
		stdio: "inherit",
	},
);
vite.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => vite.kill(signal));
}
