import { createRouter } from "@tanstack/react-router";
import { NotFoundCard } from "./components/NotFoundCard";
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

		// Unknown URLs, and anything a loader reports missing via notFound()
		// (repositories, issues, branches, files, commits, users) — a 404.
		defaultNotFoundComponent: () => (
			<div className="page-wrap px-4 py-16">
				<div className="mx-auto max-w-md">
					<NotFoundCard
						title="Page not found"
						message="This page doesn't exist, or you don't have access to it."
						backTo="/"
						backLabel="Go home"
					/>
				</div>
			</div>
		),

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
