import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { SignInToComment } from "@/components/CommentForm";
import { DiscussionComposer } from "@/components/discussions/DiscussionComposer";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
	repositoryDiscussionsQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/$owner/$name/discussions_/new")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (!repo?.hasDiscussions) throw notFound();
		return repo;
	},
	component: NewDiscussionPage,
});

function NewDiscussionPage() {
	const { owner, name } = Route.useParams();
	const repo = Route.useLoaderData();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data } = useQuery(
		repositoryDiscussionsQueryOptions({ repoId: repo.id }),
	);

	if (!session?.user) return <SignInToComment />;
	if (!data) return null;

	return (
		<div className="space-y-4">
			<h1 className="text-lg font-semibold text-bjork-text-strong">
				New discussion
			</h1>
			<DiscussionComposer
				owner={owner}
				name={name}
				repoId={repo.id}
				categories={data.categories}
				canWrite={data.viewer.canWrite}
			/>
		</div>
	);
}
