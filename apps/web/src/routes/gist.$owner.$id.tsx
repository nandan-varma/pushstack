import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { GistPage } from "@/components/gist/GistPage";
import { NotFoundCard } from "@/components/NotFoundCard";
import { gistPageQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/gist/$owner/$id")({
	loader: ({ params, location, context: { queryClient } }) => {
		// The revision child loads the same page for its own revision.
		if (location.pathname.split("/").filter(Boolean).length > 3) return;
		return queryClient.ensureQueryData(
			gistPageQueryOptions({ owner: params.owner, id: params.id }),
		);
	},
	component: GistDetailRoute,
	notFoundComponent: GistNotFound,
});

function GistDetailRoute() {
	const { owner, id } = Route.useParams();
	const matchRoute = useMatchRoute();
	if (matchRoute({ to: "/gist/$owner/$id/$revision" })) return <Outlet />;
	return (
		<div className="page-wrap py-6">
			<GistPage owner={owner} id={id} />
		</div>
	);
}

function GistNotFound() {
	return (
		<div className="page-wrap py-12">
			<div className="mx-auto max-w-md">
				<NotFoundCard
					title="Gist not found"
					message="It doesn't exist, or the link is wrong."
					backTo="/gist"
					backLabel="All gists"
				/>
			</div>
		</div>
	);
}
