import { createFileRoute } from "@tanstack/react-router";

/**
 * Codeload's `legacy.zip` shape, `/{owner}/{repo}/legacy.zip/{ref}`: where the
 * REST zipball/tarball redirect points. Entries are named
 * `{owner}-{repo}-{short sha}` (src/server/archive.ts).
 */
export const Route = createFileRoute("/$owner/$name/legacy.zip/$")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const { serveArchive } = await import("#/server/archive");
				return serveArchive(
					request,
					params.owner,
					params.name,
					params._splat ?? "",
					"zip",
					{ legacy: true },
				);
			},
		},
	},
});
