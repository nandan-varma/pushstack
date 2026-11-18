import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { WikiEditor } from "@/components/wiki/WikiEditor";
import { WikiPage } from "@/components/wiki/WikiPage";
import {
	repositoryByNameQueryOptions,
	repositoryWikiPageQueryOptions,
	repositoryWikiQueryOptions,
} from "@/lib/query-options";

/** `_new` is not a page, it is the editor for one that does not exist yet. */
const NEW_PAGE = "_new";

export const Route = createFileRoute("/$owner/$name/wiki/$page")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasWiki) throw notFound();
		if (params.page === NEW_PAGE) {
			await queryClient.ensureQueryData(repositoryWikiQueryOptions(repo.id));
		} else {
			await queryClient.ensureQueryData(
				repositoryWikiPageQueryOptions(repo.id, params.page),
			);
		}
		return { page: params.page };
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${loaderData?.page === NEW_PAGE ? "New page" : (loaderData?.page ?? "Wiki")} · ${params.owner}/${params.name} Wiki · PushStack`,
			},
		],
	}),
	component: WikiPageRoute,
});

function WikiPageRoute() {
	const { page } = Route.useParams();
	return page === NEW_PAGE ? <NewWikiPage /> : <ExistingWikiPage />;
}

function ExistingWikiPage() {
	const { owner, name, page } = Route.useParams();
	return <WikiPage owner={owner} name={name} page={page} />;
}

function NewWikiPage() {
	const { owner, name } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...repositoryWikiQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});
	if (!repo || !data) return <Skeleton className="h-64" />;
	return (
		<div className="space-y-6">
			<PageHeader title="New page" />
			{data.canEdit ? (
				<WikiEditor
					owner={owner}
					name={name}
					repoId={repo.id}
					page={null}
					initialContent=""
				/>
			) : (
				<p className="text-sm text-bjork-text-muted">
					You don't have permission to edit this wiki.
				</p>
			)}
		</div>
	);
}
