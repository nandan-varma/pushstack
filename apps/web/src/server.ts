import { withSentry } from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { rejectAbusiveRequest } from "./server/abuse-guard";

/**
 * What `withSentry` wraps. Its types come from @cloudflare/workers-types, whose
 * `Request` and `Response` are distinct declarations from the DOM ones this
 * project compiles against; the two describe the same runtime objects.
 */
type WorkerHandler = Parameters<typeof withSentry<Cloudflare.Env>>[1];

const serverEntry = createServerEntry({
	fetch: async (request, opts) =>
		(await rejectAbusiveRequest(request)) ?? handler.fetch(request, opts),
});

// The Worker boundary, wrapped so uncaught errors and the `captureException`
// calls in src/server/perf-log.ts reach Sentry. With no DSN the SDK stays
// disabled and sends nothing. The runtime calls `fetch(request, env, ctx)`;
// the wrapper forwards all three and the server entry ignores the extras.
export default withSentry(
	(env: Cloudflare.Env) => ({
		dsn: env.VITE_SENTRY_DSN,
		environment: env.ENVIRONMENT,
		tracesSampleRate: 0.1,
	}),
	serverEntry satisfies WorkerHandler,
);
