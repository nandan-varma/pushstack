import { createFileRoute } from "@tanstack/react-router";

/**
 * GitHub's GraphQL API (`POST /api/graphql`) — see src/server/graphql/index.ts.
 * Dynamically imported so graphql-js stays out of every other route's bundle.
 */
export const Route = createFileRoute("/api/graphql")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { handleGraphqlRequest } = await import("#/server/graphql");
				return handleGraphqlRequest(request);
			},
		},
	},
});
