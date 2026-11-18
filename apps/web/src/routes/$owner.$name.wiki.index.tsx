import { createFileRoute, notFound } from "@tanstack/react-router";
import { WikiPage } from "@/components/wiki/WikiPage";
import {
	repositoryByNameQueryOptions,
	repositoryWikiQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/wiki/")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasWiki) throw notFound();
		await queryClient.ensureQueryData(repositoryWikiQueryOptions(repo.id));
	},
	head: ({ params }) => ({
		meta: [{ title: `${params.owner}/${params.name} Wiki · PushStack` }],
	}),
	component: WikiHomePage,
});

function WikiHomePage() {
	const { owner, name } = Route.useParams();
	return <WikiPage owner={owner} name={name} />;
}
