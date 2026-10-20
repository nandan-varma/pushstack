import { createFileRoute } from "@tanstack/react-router";

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
