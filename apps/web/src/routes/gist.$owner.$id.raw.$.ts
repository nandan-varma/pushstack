import { createFileRoute } from "@tanstack/react-router";

/** A gist file's raw bytes: `/gist/{owner}/{id}/raw/{revision}/{...path}`. */
export const Route = createFileRoute("/gist/$owner/$id/raw/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { serveGistRawFile } = await import("#/server/gist-raw");
				return serveGistRawFile(request);
			},
		},
	},
});
