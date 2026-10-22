import { type Query, QueryClient } from "@tanstack/react-query";

type AppContext = {
	queryClient: QueryClient;
};

let clientContext: AppContext | undefined;

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: 30_000,
				gcTime: 10 * 60_000,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
			mutations: {
				retry: false,
			},
		},
	});
}

function createAppContext(): AppContext {
	return {
		queryClient: createQueryClient(),
	};
}

export function getContext() {
	if (typeof window === "undefined") {
		return createAppContext();
	}

	if (!clientContext) {
		clientContext = createAppContext();
	}

	return clientContext;
}

/**
 * Which server queries reach the browser: what the server has, or is still
 * fetching (that streams in when it lands). A query useQuery merely *created*
 * during the server render was never fetched there; shipped as pending, the
 * browser would wait forever on a fetch that never happens.
 */
export function shouldDehydrateQuery(query: Query) {
	return query.state.status === "success" || query.promise !== undefined;
}
