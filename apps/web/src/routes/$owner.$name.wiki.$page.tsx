import { createFileRoute, notFound } from "@tanstack/react-router";
import { WikiPage } from "@/components/wiki/WikiPage";
import {
	repositoryByNameQueryOptions,
	repositoryWikiPageQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/wiki/$page")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasWiki) throw notFound();
		await queryClient.ensureQueryData(
			repositoryWikiPageQueryOptions(repo.id, params.page),
		);
		return { page: params.page };
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${loaderData?.page ?? "Wiki"} · ${params.owner}/${params.name} Wiki · PushStack`,
			},
		],
	}),
	component: WikiPageRoute,
});

function WikiPageRoute() {
	const { owner, name, page } = Route.useParams();
	return <WikiPage owner={owner} name={name} page={page} />;
}
