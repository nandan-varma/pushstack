import "../instrument.server.mjs";
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// Vercel serverless functions can't use Node's `--import`/`NODE_OPTIONS`
// preload flag to load Sentry's server instrumentation ahead of the app (no
// control over the function runtime's invocation), so the instrumentation
// import above plus this fetch wrapper is the supported alternative for
// this deploy target — see docs/deployment.md.
export default createServerEntry(
	wrapFetchWithSentry({
		fetch(request: Request) {
			return handler.fetch(request);
		},
	}),
);
