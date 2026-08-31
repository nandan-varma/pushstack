import { createRouter } from "@tanstack/react-router";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createRouter({
		routeTree,

		// getContext() (not createAppContext()) so the router's loaders
		// (ensureQueryData) and TanStackQueryProvider's <QueryClientProvider>
		// share the exact same QueryClient instance on the client — otherwise
		// loaders populate a QueryClient nothing reads from, and every
		// component-level useQuery has to refetch from scratch, doubling every
		// request the loader already made.
		context: getContext(),

		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 30_000,
	});

	// Client-only: the server side is initialized in instrument.server.mjs.
	// No-ops if VITE_SENTRY_DSN isn't set.
	if (!router.isServer && import.meta.env.VITE_SENTRY_DSN) {
		void import("@sentry/tanstackstart-react").then((Sentry) => {
			Sentry.init({
				dsn: import.meta.env.VITE_SENTRY_DSN,
				environment: import.meta.env.MODE,
				integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
				tracesSampleRate: 0.1,
			});
		});
	}

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
