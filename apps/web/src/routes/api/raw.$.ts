import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/raw/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { serveRawFile } = await import("#/server/raw");
				return serveRawFile(request);
			},
		},
	},
});
