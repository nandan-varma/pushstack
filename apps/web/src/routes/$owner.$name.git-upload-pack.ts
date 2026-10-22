import { createFileRoute } from "@tanstack/react-router";

/**
 * Git smart HTTP at GitHub's clone URL — `POST /{owner}/{repo}[.git]/git-upload-pack`: clone and fetch
 * (src/server/git-http.ts). Dynamically imported so the server modules stay
 * out of every other route's bundle.
 */
export const Route = createFileRoute("/$owner/$name/git-upload-pack")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { serveGitRequest } = await import("#/server/git-http");
				return serveGitRequest(request);
			},
		},
	},
});
