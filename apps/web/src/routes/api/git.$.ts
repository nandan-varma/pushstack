import { createFileRoute } from "@tanstack/react-router";

/**
 * The git smart-HTTP endpoint (clone, fetch, push) — see
 * src/server/git-http.ts. Dynamically imported so the server modules stay
 * out of every other route's bundle.
 */
async function serve(request: Request): Promise<Response> {
	const { serveGitRequest } = await import("#/server/git-http");
	return serveGitRequest(request);
}

export const Route = createFileRoute("/api/git/$")({
	server: {
		handlers: {
			GET: ({ request }) => serve(request),
			POST: ({ request }) => serve(request),
		},
	},
});
