import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { DiscussionList } from "@/components/discussions/DiscussionList";
import { Toolbar } from "@/components/layout/page";
import { MAX_DISCUSSION_CATEGORY_SLUG_CHARS } from "@/lib/limits";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
	repositoryDiscussionsQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/discussions/")({
	validateSearch: z.object({
		category: z.string().max(MAX_DISCUSSION_CATEGORY_SLUG_CHARS).optional(),
	}),
	loaderDeps: ({ search }) => ({ category: search.category }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasDiscussions) throw notFound();
		await queryClient.ensureQueryData(
			repositoryDiscussionsQueryOptions({
				repoId: repo.id,
				category: deps.category,
			}),
		);
		return repo;
	},
	component: DiscussionsPage,
});

function DiscussionsPage() {
	const { owner, name } = Route.useParams();
	const { category } = Route.useSearch();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data } = useQuery(
		repositoryDiscussionsQueryOptions({
			repoId: Route.useLoaderData().id,
			category,
		}),
	);

	return (
		<div className="space-y-4">
			<Toolbar>
				<h1 className="text-lg font-semibold text-bjork-text-strong">
					Discussions
				</h1>
			</Toolbar>
			<DiscussionList
				owner={owner}
				name={name}
				category={category}
				categories={data?.categories ?? []}
				discussions={data?.discussions}
				isLoading={!data}
				signedIn={Boolean(session?.user)}
			/>
		</div>
	);
}
