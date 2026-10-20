import { createFileRoute } from "@tanstack/react-router";

/**
 * The GitHub-compatible REST API (`/api/v3/*`) — see src/server/api/index.ts
 * and apps/docs/content/docs/api/index.md. Dynamically imported so the server modules stay out of
 * every other route's bundle.
 */
async function serve(request: Request): Promise<Response> {
	const { handleApiRequest } = await import("#/server/api");
	return handleApiRequest(request);
}

export const Route = createFileRoute("/api/v3/$")({
	server: {
		handlers: {
			GET: ({ request }) => serve(request),
			HEAD: ({ request }) => serve(request),
			POST: ({ request }) => serve(request),
			PUT: ({ request }) => serve(request),
			PATCH: ({ request }) => serve(request),
			DELETE: ({ request }) => serve(request),
		},
	},
});
