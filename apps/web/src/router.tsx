import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getGlobalStartContext } from "@tanstack/react-start";
import { NotFoundCard } from "./components/NotFoundCard";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

interface StartRequestContext {
	nonce?: string;
}

export function getRouter() {
	// The CSP nonce the request middleware generated (src/server/csp.ts), which
	// TanStack Router stamps on every script and style it renders and React's
	// streamed renderer uses for its bootstrap scripts. It is undefined in the
	// browser, where a per-request nonce does not exist.
	//
	// The cast is because `getGlobalStartContext()`'s type is derived from the
	// start instance's *registered* request middlewares, and this app assembles
	// that array at runtime (the CSP middleware is a dynamic import, so the Sentry
	// SDK it would otherwise drag in stays server-only) — the declaration below
	// is the shape `next({ context: { nonce } })` sends, and the middleware
	// above is what guarantees it was present by the time this runs.
	const nonce = (getGlobalStartContext() as StartRequestContext | undefined)
		?.nonce;

	// One QueryClient per request on the server (and one for the page's life in
	// the browser), shared by loaders and components.
	const context = getContext();
	const router = createRouter({
		routeTree,
		ssr: nonce ? { nonce } : undefined,

		// getContext() (not createAppContext()) so the router's loaders
		// (ensureQueryData) and TanStackQueryProvider's <QueryClientProvider>
		// share the exact same QueryClient instance on the client — otherwise
		// loaders populate a QueryClient nothing reads from, and every
		// component-level useQuery has to refetch from scratch, doubling every
		// request the loader already made.
		context,

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

	// Streams what loaders fetched on the server into the page so components
	// render it there and the browser hydrates the same data instead of
	// refetching it, and provides the QueryClient to the whole tree.
	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

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
