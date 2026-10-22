import { createFileRoute } from "@tanstack/react-router";
import { splitPatchSuffix } from "@/lib/compare-spec";

/**
 * GitHub's spelling of a pull request URL, `/{owner}/{repo}/pull/{n}`:
 * `.diff`/`.patch` are served as plain text, anything else redirects to the
 * pull request page.
 */
export const Route = createFileRoute("/$owner/$name/pull/$id")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const suffix = splitPatchSuffix(params.id);
				if (suffix) {
					const { servePullPatch } = await import("#/server/web-patches");
					return servePullPatch(
						params.owner,
						params.name,
						suffix.name,
						suffix.format,
					);
				}
				const url = new URL(request.url);
				url.pathname = url.pathname.replace(/\/pull\/([^/]+)$/, "/pulls/$1");
				return Response.redirect(url.toString(), 301);
			},
		},
	},
});
