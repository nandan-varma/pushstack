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

const localDir = path.resolve(
	process.env.PUSHSTACK_LOCAL_DIR ?? ".pushstack-local",
);
mkdirSync(localDir, { recursive: true });

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

const setup = spawn("pnpm", ["exec", "tsx", "scripts/seed-local.ts"], {
	env,
	stdio: "inherit",
});
await new Promise<void>((resolve, reject) => {
	setup.once("error", reject);
	setup.once("exit", (code) => {
		if (code === 0) resolve();
		else reject(new Error(`Local database setup exited with ${code}`));
	});
});

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
