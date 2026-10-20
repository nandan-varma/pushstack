/**
 * The Content-Security-Policy header, built per request.
 *
 * `script-src` is nonce-based instead of `'unsafe-inline'`. Without a nonce an
 * injected inline script or event handler still executes, which makes the
 * policy decorative against the attack it exists for; with one, only the tags
 * the server stamped can run. The nonce is generated per request, handed to the
 * router through the middleware context (so every script React and TanStack
 * Router render carries it — see `src/router.tsx`), and written into the header
 * here, both from this same middleware call.
 *
 * Our own inline theme script is allowed by *hash* rather than by nonce. It is
 * a build-time constant (`src/lib/theme.ts`), and a hash needs nothing from the
 * client render, where a per-request nonce legitimately does not exist.
 *
 * `style-src` deliberately keeps `'unsafe-inline'` and carries no nonce:
 * Shiki's highlighted output puts theme colours in inline `style` *attributes*,
 * which no nonce can cover, and in browsers that implement "a nonce makes
 * 'unsafe-inline' ineffective" adding one here would break highlighting. Inline
 * styles cannot execute script, so the concession stays confined to CSS.
 *
 * In a development build the header is sent report-only: Vite's client and the
 * TanStack devtools inject inline scripts that carry no nonce, and enforcing a
 * nonce policy there would break the dev server rather than secure it. Sending
 * the same policy report-only keeps the two in step and surfaces violations
 * during development instead of at deploy time.
 */
import { createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { THEME_INIT_SCRIPT } from "#/lib/theme";

/** Entropy for the per-request nonce, in bytes. */
const NONCE_BYTES = 16;

/** A fresh, unguessable nonce: 128 bits, base64. */
export function generateNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function sha256Base64(source: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(source),
	);
	let binary = "";
	for (const byte of new Uint8Array(digest))
		binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * The theme script's hash, computed once per process. It is derived from the
 * same constant the root document renders, so the two cannot disagree.
 */
let themeScriptHash: Promise<string> | undefined;

function themeScriptSource(): Promise<string> {
	themeScriptHash ??= sha256Base64(THEME_INIT_SCRIPT).then(
		(hash) => `'sha256-${hash}'`,
	);
	return themeScriptHash;
}

/**
 * The policy. `nonce` is `null` only in a development build, where scripts are
 * additionally allowed inline so the dev server's own injected scripts run.
 */
export async function contentSecurityPolicy(
	nonce: string | null,
): Promise<string> {
	const scriptSources = ["'self'"];
	if (nonce) scriptSources.push(`'nonce-${nonce}'`);
	else scriptSources.push("'unsafe-inline'");
	scriptSources.push(await themeScriptSource());

	// The browser SDK posts error envelopes straight to Sentry's origin, which
	// must be in connect-src or every client-captured error is dropped silently.
	const sentryDsn = process.env.VITE_SENTRY_DSN ?? "";
	// With no DSN there is no ingest origin to allow, so connect-src keeps only
	// the app's own origins.
	let sentryOrigin = "";
	if (sentryDsn) {
		try {
			sentryOrigin = new URL(sentryDsn).origin;
		} catch {
			// A malformed DSN is Sentry's own problem to report; the policy just
			// doesn't need an extra origin for it.
		}
	}

	return [
		"default-src 'self'",
		`script-src ${scriptSources.join(" ")}`,
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		// READMEs link images from anywhere; that is a content decision, not a
		// script-execution one.
		"img-src 'self' data: blob: https:",
		"font-src 'self' https://fonts.gstatic.com",
		`connect-src 'self'${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"object-src 'none'",
		// Has no fallback to default-src, so without it a submitted form can post
		// anywhere.
		"form-action 'self'",
	].join("; ");
}

/**
 * The global request middleware. It generates the nonce, hands it to the rest of
 * the request through the middleware context (where `src/router.tsx` reads it
 * with `getGlobalStartContext()`), and sets the header — both from this one
 * call, so the document and the header cannot disagree about the nonce.
 */
export const cspMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		const nonce = generateNonce();
		setResponseHeader(
			import.meta.env.PROD
				? "Content-Security-Policy"
				: "Content-Security-Policy-Report-Only",
			await contentSecurityPolicy(nonce),
		);
		return next({ context: { nonce } });
	},
);
