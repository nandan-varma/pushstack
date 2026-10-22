import { createFileRoute } from "@tanstack/react-router";

/** GitHub's raw file URL, `/{owner}/{repo}/raw/{ref}/{...path}` (src/server/raw.ts). */
export const Route = createFileRoute("/$owner/$name/raw/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { serveRawFile } = await import("#/server/raw");
				return serveRawFile(request);
			},
		},
	},
});
