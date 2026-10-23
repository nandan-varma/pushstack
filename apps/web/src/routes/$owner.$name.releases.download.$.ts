import { createFileRoute } from "@tanstack/react-router";

/**
 * `GET /{owner}/{repo}/releases/download/{tag}/{asset}`: a release asset's
 * bytes, streamed from R2 (src/server/release-assets.ts). The tag may contain
 * slashes; the asset name is the last segment.
 */
export const Route = createFileRoute("/$owner/$name/releases/download/$")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const { serveReleaseDownload } = await import(
					"#/server/release-assets"
				);
				const segments = (params._splat ?? "").split("/");
				const asset = segments.pop() ?? "";
				return serveReleaseDownload(
					request,
					params.owner,
					params.name,
					segments.join("/"),
					asset,
				);
			},
		},
	},
});
