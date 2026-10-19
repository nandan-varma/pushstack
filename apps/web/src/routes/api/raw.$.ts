import { createFileRoute } from "@tanstack/react-router";

/** A file's raw bytes at a ref — see src/server/raw.ts. */
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
