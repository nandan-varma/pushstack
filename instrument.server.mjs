import * as Sentry from "@sentry/tanstackstart-react";

// Only reports if VITE_SENTRY_DSN is set — Sentry.init with an empty/undefined
// dsn disables the SDK rather than throwing, so this is safe to import
// unconditionally (including in local dev with no DSN configured).
Sentry.init({
	dsn: process.env.VITE_SENTRY_DSN,
	environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
	// Vercel serverless functions are invoked per-request, so batch flush
	// doesn't get a background tick between requests the way a long-running
	// Node process would — capped low mainly to bound cost, not latency.
	tracesSampleRate: 0.1,
});
