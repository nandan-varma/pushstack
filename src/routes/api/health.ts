import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "#/db/index";

/**
 * Uptime-monitor target: GET /api/health
 *
 * Checks real DB connectivity (the one dependency every request needs)
 * rather than just returning a static 200, so a monitor actually catches a
 * dead Neon connection instead of reporting healthy while every real route 500s.
 */
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => {
				try {
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
