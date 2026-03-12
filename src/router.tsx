import { createRouter } from "@tanstack/react-router";
import { createAppContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createRouter({
		routeTree,

		context: createAppContext(),

		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 30_000,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
