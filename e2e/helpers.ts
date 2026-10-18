import { neon } from "@neondatabase/serverless";
import type { Page } from "@playwright/test";

// Shared across every e2e spec that needs a real, disposable user: registers
// go through the actual Postgres database (see auth.spec.ts's original
// comment) since there's no way to read the real verification email here.
//
// These helpers DELETE rows, and `.env.local` is the file a developer is most
// likely to have pointed at a real database, so the client refuses a non-local
// host unless `E2E_ALLOW_REMOTE_DB=1` is set deliberately.
export function dbClient() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is not set — cannot verify test user email");
	}
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		throw new Error(
			"DATABASE_URL is not a valid URL — cannot verify test user email",
		);
	}
	const isLocal =
		host === "localhost" || host === "127.0.0.1" || host === "::1";
	if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "1") {
		throw new Error(
			`Refusing to run e2e against the remote database ${host}: these helpers ` +
				"delete rows. Point DATABASE_URL at a local database, or set " +
				"E2E_ALLOW_REMOTE_DB=1 to run against this one on purpose.",
		);
	}
	return neon(url);
}

export async function verifyUserEmail(email: string) {
	const sql = dbClient();
	await sql`UPDATE "user" SET "emailVerified" = true WHERE email = ${email}`;
}

export async function deleteTestUser(email: string) {
	const sql = dbClient();
	await sql`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${email})`;
	await sql`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${email})`;
	await sql`DELETE FROM "user" WHERE email = ${email}`;
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
