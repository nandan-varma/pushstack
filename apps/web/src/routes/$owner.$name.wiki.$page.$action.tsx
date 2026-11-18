import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { BackLink } from "@/components/ui/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { WikiEditor } from "@/components/wiki/WikiEditor";
import {
	repositoryByNameQueryOptions,
	repositoryWikiPageQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/wiki/$page/$action")({
	loader: async ({ params, context: { queryClient } }) => {
		if (params.action !== "_edit") throw notFound();
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasWiki) throw notFound();
		return queryClient.ensureQueryData(
			repositoryWikiPageQueryOptions(repo.id, params.page),
		);
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `Editing ${params.page} · ${params.owner}/${params.name} Wiki · PushStack`,
			},
		],
	}),
	component: EditWikiPage,
});

function EditWikiPage() {
	const { owner, name, page } = Route.useParams();
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data } = useQuery({
		...repositoryWikiPageQueryOptions(repo?.id ?? 0, page),
		enabled: !!repo,
	});
	return (
		<div className="space-y-6">
			<BackLink
				to="/$owner/$name/wiki/$page"
				params={{ owner, name, page }}
				label={page}
			/>
			<PageHeader title={`Editing ${page}`} />
			{repo && data?.canEdit ? (
				<WikiEditor
					owner={owner}
					name={name}
					repoId={repo.id}
					page={page}
					initialContent={data.page?.content ?? ""}
				/>
			) : data ? (
				<p className="text-sm text-bjork-text-muted">
					You don't have permission to edit this wiki.
				</p>
			) : (
				<Skeleton className="h-64" />
			)}
		</div>
	);
}
