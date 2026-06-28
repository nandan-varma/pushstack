import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

export type AppContext = {
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

export function createAppContext(): AppContext {
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

export default function TanStackQueryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [queryClient] = useState(() => getContext().queryClient);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
