import { createFileRoute } from "@tanstack/react-router";

/**
 * Uptime-monitor target: GET /api/health
 *
 * Checks real DB connectivity (the one dependency every request needs)
 * rather than just returning a static 200, so a monitor actually catches a
 * dead Neon connection instead of reporting healthy while every real route 500s.
 * `?shallow=1` skips the DB check: frequent DB pings keep Neon's compute from
 * auto-suspending, so point high-frequency monitors there instead.
 */
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				if (new URL(request.url).searchParams.has("shallow")) {
					return Response.json({ status: "ok" });
				}
				try {
					const [{ sql }, { db }] = await Promise.all([
						import("drizzle-orm"),
						import("#/db/index"),
					]);
					await db.execute(sql`select 1`);
					return Response.json({ status: "ok" });
				} catch (err) {
					return Response.json(
						{
							status: "error",
							message: err instanceof Error ? err.message : String(err),
						},
						{ status: 503 },
					);
				}
			},
		},
	},
});
