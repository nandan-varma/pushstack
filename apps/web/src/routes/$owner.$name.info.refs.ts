import { createFileRoute } from "@tanstack/react-router";

/**
 * Git smart HTTP at GitHub's clone URL — `GET /{owner}/{repo}[.git]/info/refs?service=…`: the ref advertisement
 * (src/server/git-http.ts). Dynamically imported so the server modules stay
 * out of every other route's bundle.
 */
export const Route = createFileRoute("/$owner/$name/info/refs")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { serveGitRequest } = await import("#/server/git-http");
				return serveGitRequest(request);
			},
		},
	},
});
