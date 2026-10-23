import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { repositoryByNameQueryOptions } from "@/lib/query-options";
import { getLatestReleaseTag } from "@/server/releases";

/** `/{owner}/{repo}/releases/latest`: GitHub redirects to the latest release's page. */
export const Route = createFileRoute("/$owner/$name/releases/latest")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo) throw notFound();
		const tag = await getLatestReleaseTag({ data: { repoId: repo.id } });
		if (!tag) throw notFound();
		throw redirect({
			to: "/$owner/$name/releases/tag/$",
			params: { owner: params.owner, name: params.name, _splat: tag },
		});
	},
});
