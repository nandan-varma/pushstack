import {
	type AnyFunctionMiddleware,
	type AnyRequestMiddleware,
	createCsrfMiddleware,
	createStart,
} from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

// Sentry's middlewares must run first in each array to see every downstream
// request/server-function error. SSR render exceptions aren't covered by
// either (see src/routes/__root.tsx's RootErrorComponent for that case).
// Loaded on the server only: their client halves are no-ops, and a static
// import here puts the whole Sentry SDK in the client's main chunk. The
// browser SDK loads lazily from src/router.tsx instead.
interface GlobalMiddleware {
	requestMiddleware: AnyRequestMiddleware[];
	functionMiddleware: AnyFunctionMiddleware[];
}

export const startInstance = createStart(
	async (): Promise<GlobalMiddleware> => {
		if (!import.meta.env.SSR) {
			return { requestMiddleware: [csrfMiddleware], functionMiddleware: [] };
		}
		// The CSP middleware has to run before anything renders: it generates the
		// per-request nonce and hands it to the router through the middleware
		// context (src/server/csp.ts, read back in src/router.tsx).
		const { cspMiddleware } = await import("#/server/csp");
		// Outermost, so the request id covers everything below it.
		const { requestIdMiddleware } = await import("#/server/request-id");
		// With no DSN there is nothing to report to, so the SDK is never imported
		// and never initialized. (Whether the bundler also keeps its code out of
		// the SSR entry chunk is a bundling decision, not something this changes.)
		if (!process.env.VITE_SENTRY_DSN) {
			return {
				requestMiddleware: [requestIdMiddleware, cspMiddleware, csrfMiddleware],
				functionMiddleware: [],
			};
		}
		const { sentryGlobalFunctionMiddleware, sentryGlobalRequestMiddleware } =
			await import("@sentry/tanstackstart-react");
		return {
			requestMiddleware: [
				requestIdMiddleware,
				sentryGlobalRequestMiddleware,
				cspMiddleware,
				csrfMiddleware,
			],
			functionMiddleware: [sentryGlobalFunctionMiddleware],
		};
	},
);
