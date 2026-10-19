import { createFileRoute, redirect } from "@tanstack/react-router";
import { repositoryByNameQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/repo/$owner/$name/")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo) return;
		throw redirect({
			to: "/repo/$owner/$name/tree/$branch/$",
			params: {
				owner: params.owner,
				name: params.name,
				branch: repo.defaultBranch,
				_splat: "",
			},
			replace: true,
		});
	},
});
