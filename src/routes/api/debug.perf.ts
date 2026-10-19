import { createFileRoute } from "@tanstack/react-router";

/**
 * Dev-only debug page: the perf trees of the most recent requests, newest
 * first (GET /api/debug/perf). 404 outside development.
 */
export const Route = createFileRoute("/api/debug/perf")({
	server: {
		handlers: {
			GET: async () => {
				if (!import.meta.env.DEV)
					return new Response("Not Found", { status: 404 });
				const { recentPerfTrees } = await import("#/server/perf-log");
				const body = recentPerfTrees().join("\n\n") || "No requests yet.";
				return new Response(body, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				});
			},
		},
	},
});
