import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			// Keep Better Auth (and its email adapter) out of every SSR route's
			// module graph. This endpoint is the only consumer of the handler.
			GET: async ({ request }) =>
				(await import("#/lib/auth")).auth.handler(request),
			POST: async ({ request }) =>
				(await import("#/lib/auth")).auth.handler(request),
		},
	},
});
