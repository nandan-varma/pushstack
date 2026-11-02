import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// Shared across every e2e spec that needs a real, disposable user: registers
// go through the local database (see auth.spec.ts's original comment) since
// there's no way to read the real verification email here.
//
// These helpers DELETE rows, so they only ever touch the local simulated D1
// that `pnpm dev:local` persists under `.pushstack-local/state`
// (scripts/dev-local.ts). `wrangler d1 execute --local --persist-to` cannot
// reach a remote database, and the helpers refuse to run when that state is
// missing rather than falling back to anything else.
const LOCAL_STATE_DIR = path.resolve(
	process.env.PUSHSTACK_LOCAL_DIR ?? ".pushstack-local",
	"state",
);

// `wrangler d1 execute --json` prints one result set per statement.
const d1OutputSchema = z.array(
	z.object({ success: z.literal(true), results: z.array(z.unknown()) }),
);

/** A SQL string literal with single quotes doubled. For values the tests choose. */
export function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

async function runLocalSql(statement: string): Promise<unknown[]> {
	if (!existsSync(LOCAL_STATE_DIR)) {
		throw new Error(
			`No local database at ${LOCAL_STATE_DIR}: start the app once with pnpm dev:local.`,
		);
	}
	const { stdout } = await execFileAsync("pnpm", [
		"exec",
		"wrangler",
		"d1",
		"execute",
		"DB",
		"--local",
		"--persist-to",
		LOCAL_STATE_DIR,
		"--json",
		"--command",
		statement,
	]);
	const [output] = d1OutputSchema.parse(JSON.parse(stdout));
	if (!output) throw new Error("wrangler returned no result set");
	return output.results;
}

/** Runs a SELECT and parses every row with `row`. */
export async function queryLocal<S extends z.ZodType>(
	row: S,
	statement: string,
): Promise<z.output<S>[]> {
	return z.array(row).parse(await runLocalSql(statement));
}

const emailRow = z.object({ email: z.string() });

export async function findUserEmails(email: string) {
	return queryLocal(
		emailRow,
		`SELECT email FROM "user" WHERE email = ${sqlLiteral(email)}`,
	);
}

export async function verifyUserEmail(email: string) {
	await runLocalSql(
		`UPDATE "user" SET "emailVerified" = 1 WHERE email = ${sqlLiteral(email)}`,
	);
}

export async function deleteTestUser(email: string) {
	const literal = sqlLiteral(email);
	await runLocalSql(
		`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${literal})`,
	);
	await runLocalSql(
		`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${literal})`,
	);
	await runLocalSql(`DELETE FROM "user" WHERE email = ${literal}`);
}

/**
 * Navigate and wait for the SPA to finish hydrating before interacting with
 * the page. Without this, a fast `fill()`+`click()` right after `page.goto()`
 * can land between first paint (SSR'd static markup) and React attaching
 * event handlers: typing into a controlled `<input>` before hydration writes
 * straight to the DOM, invisible to React state, and React's hydration then
 * resets the input back to its initial (empty) value; a `submit` click in
 * that same window falls through to the browser's native, JS-free form
 * submit (a GET to the current URL) instead of the real onSubmit handler.
 * This isn't just a test-speed artifact — real users get the exact same
 * failure from password-manager/browser autofill firing immediately on
 * page load. `networkidle` reliably lands after the JS bundle + hydration
 * have settled, at the cost of being slower than a real user would ever
 * need to wait.
 */
export async function gotoAndWaitForHydration(page: Page, path: string) {
	await page.goto(path);
	await page.waitForLoadState("networkidle");
}
