/**
 * Response headers every dynamic response carries. Static assets get the same
 * set from `public/_headers`, which Cloudflare serves without invoking the
 * Worker; `__tests__/security-headers.test.ts` keeps the two in step.
 *
 * The Content-Security-Policy is deliberately not here: it carries a
 * per-request nonce, so `csp.ts` sets it. See
 * apps/docs/content/docs/internals/security.md.
 */
import { createMiddleware } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";

export const SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	// The forge is private-by-default tooling, not a publication: crawlers only
	// cost compute (each repo view renders in the Worker), so they are refused
	// in robots.txt and told not to index or train on whatever they do fetch.
	"X-Robots-Tag": "noindex, nofollow, noarchive, noimageai, noai",
} as const;

export const securityHeadersMiddleware = createMiddleware({
	type: "request",
}).server(({ next }) => {
	setResponseHeaders(new Headers(SECURITY_HEADERS));
	return next();
});
