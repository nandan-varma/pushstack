import { createFileRoute } from "@tanstack/react-router";

/**
 * GitHub's source archives, `/{owner}/{repo}/archive/refs/heads/{branch}.zip`,
 * `…/refs/tags/{tag}.tar.gz`, `…/archive/{sha}.zip` (src/server/archive.ts).
 */
export const Route = createFileRoute("/$owner/$name/archive/$")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const { serveArchive, splitArchiveSuffix } = await import(
					"#/server/archive"
				);
				const suffix = splitArchiveSuffix(params._splat ?? "");
				if (!suffix) return new Response("Not found", { status: 404 });
				return serveArchive(
					request,
					params.owner,
					params.name,
					suffix.name,
					suffix.format,
				);
			},
		},
	},
});
