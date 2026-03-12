import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	type AnyRoute,
	createMemoryHistory,
	createRootRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { type RenderOptions, render } from "@testing-library/react";
import type React from "react";

// Create a root route for testing
export const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

// Test router factory
export function createTestRouter(
	routes: AnyRoute[],
	options: {
		initialLocation?: string;
		context?: Record<string, unknown>;
	} = {},
) {
	const { initialLocation = "/", context } = options;

	const routeTree = rootRoute.addChildren(routes);

	const router = createRouter({
		routeTree,
		history: createMemoryHistory({
			initialEntries: [initialLocation],
		}),
		context,
	});

	return router;
}

// Custom render function with router
interface RenderWithRouterOptions extends Omit<RenderOptions, "wrapper"> {
	router?: ReturnType<typeof createTestRouter>;
	initialLocation?: string;
	routes?: AnyRoute[];
	context?: Record<string, unknown>;
	queryClient?: QueryClient;
}

export function renderWithRouter(
	_ui: React.ReactElement | null = null,
	{
		router,
		initialLocation = "/",
		routes = [],
		context,
		queryClient,
		...renderOptions
	}: RenderWithRouterOptions = {},
) {
	if (!router && routes.length > 0) {
		router = createTestRouter(routes, { initialLocation, context });
	}

	if (!router) {
		throw new Error(
			"Router is required. Provide either a router or routes array.",
		);
	}

	// Always render RouterProvider
	const content = queryClient ? (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	) : (
		<RouterProvider router={router} />
	);

	const result = render(content, { ...renderOptions });

	return {
		...result,
		router,
	};
}

// Create a test QueryClient with sensible defaults
export function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
			mutations: {
				retry: false,
			},
		},
	});
}
