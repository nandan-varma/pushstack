import { createFileRoute } from "@tanstack/react-router";
import { GistPage } from "@/components/gist/GistPage";
import { NotFoundCard } from "@/components/NotFoundCard";
import { gistPageQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/gist/$owner/$id/$revision")({
	loader: ({ params, context: { queryClient } }) =>
		queryClient.ensureQueryData(
			gistPageQueryOptions({
				owner: params.owner,
				id: params.id,
				revision: params.revision,
			}),
		),
	component: GistRevisionRoute,
	notFoundComponent: GistRevisionNotFound,
});

function GistRevisionRoute() {
	const { owner, id, revision } = Route.useParams();
	return (
		<div className="page-wrap py-6">
			<GistPage owner={owner} id={id} revision={revision} />
		</div>
	);
}

function GistRevisionNotFound() {
	return (
		<div className="page-wrap py-12">
			<div className="mx-auto max-w-md">
				<NotFoundCard
					title="Revision not found"
					message="This gist has no revision with that id."
					backTo="/gist"
					backLabel="Back to the gist"
				/>
			</div>
		</div>
	);
}
