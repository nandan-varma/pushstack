import { QueryClient } from "@tanstack/react-query";

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
