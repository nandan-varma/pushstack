/**
 * `pnpm db:push`: push the schema, then backfill the login registry. A wrapper
 * so flags (`--force`, `--explain`, `--hints`) reach drizzle-kit only.
 */
import { spawnSync } from "node:child_process";

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["exec", "drizzle-kit", "push", ...process.argv.slice(2)]);
run("pnpm", ["exec", "tsx", "scripts/backfill-logins.ts"]);
