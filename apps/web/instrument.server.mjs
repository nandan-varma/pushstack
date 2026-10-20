// Sentry is loaded only when a DSN is configured. Nothing in the app reports
// without one — the fetch wrapper (src/server.ts), the global middlewares
// (src/start.ts) and perf-log's reporter are gated the same way — so importing
// the SDK would be cold-start cost on every serverless instance for nothing.
if (process.env.VITE_SENTRY_DSN) {
	const Sentry = await import("@sentry/tanstackstart-react");
	Sentry.init({
		dsn: process.env.VITE_SENTRY_DSN,
		environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
		// Vercel serverless functions are invoked per-request, so batch flush
		// doesn't get a background tick between requests the way a long-running
		// Node process would — capped low mainly to bound cost, not latency.
		tracesSampleRate: 0.1,
	});
}
