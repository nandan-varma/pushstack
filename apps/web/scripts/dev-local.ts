/**
 * `pnpm dev:local`: run PushStack with no cloud accounts. The Worker runs under
 * workerd with simulated D1 and R2, persisted under `.pushstack-local/`
 * (override with PUSHSTACK_LOCAL_DIR; delete it to start over). The code that
 * runs is the code that deploys. Emails print to the terminal
 * (src/lib/email.ts).
 *
 * The Worker's variables are set here rather than read from `.dev.vars`, so
 * this never touches a real service even when `.dev.vars` points at one.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const localDir = path.resolve(
	process.env.PUSHSTACK_LOCAL_DIR ?? ".pushstack-local",
);
const stateDir = path.join(localDir, "state");
mkdirSync(stateDir, { recursive: true });

// Bring the local database up to the current migrations before serving.
const migrate = spawnSync(
	"pnpm",
	[
		"exec",
		"wrangler",
		"d1",
		"migrations",
		"apply",
		"DB",
		"--local",
		"--persist-to",
		stateDir,
	],
	{ stdio: "inherit" },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// `PORT` lets several worktrees run their own local server side by side.
const port = process.env.PORT || "3000";
const workerVars = {
	ENVIRONMENT: "local",
	BETTER_AUTH_URL: `http://localhost:${port}`,
	BETTER_AUTH_SECRET: "pushstack-local-dev-secret-not-for-production",
	R2_BUCKET_NAME: "local",
	R2_ENDPOINT: "http://localhost",
};

console.info(`[dev:local] data in ${localDir}`);
const vite = spawn(
	"pnpm",
	["exec", "vite", "dev", "--port", port, "--strictPort"],
	{
		env: {
			...process.env,
			PUSHSTACK_LOCAL_DIR: localDir,
			PUSHSTACK_LOCAL_VARS: JSON.stringify(workerVars),
		},
		stdio: "inherit",
	},
);
vite.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => vite.kill(signal));
}
