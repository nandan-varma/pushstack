import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { gistIndexQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/gist/")({
	loader: ({ context: { queryClient } }) =>
		queryClient.ensureQueryData(gistIndexQueryOptions()),
	component: GistIndexPage,
});

function GistIndexPage() {
	const { data, isLoading } = useQuery(gistIndexQueryOptions());
	return (
		<div className="page-wrap space-y-5 py-6">
			<PageHeader
				title={data?.signedIn ? "Your gists" : "Recent gists"}
				description={
					data?.signedIn
						? "Gists you have created."
						: "Public gists, most recently updated first."
				}
			/>
			{isLoading || !data ? (
				<Skeleton className="h-40" />
			) : data.gists.length === 0 ? (
				<EmptyState
					title="No gists"
					message="Gists are small repositories of files: snippets, notes and scripts."
				/>
			) : (
				<Panel>
					<ul className="divide-y divide-bjork-border-muted">
						{data.gists.map((gist) => (
							<li key={gist.id} className="px-5 py-4">
								<Link
									to="/gist/$owner/$id"
									params={{ owner: gist.owner.username, id: gist.id }}
									className="font-mono text-sm font-semibold hover:underline"
								>
									{gist.files[0] ?? gist.id}
									{gist.files.length > 1 && ` +${gist.files.length - 1}`}
								</Link>
								<p className="mt-0.5 text-sm text-bjork-text-muted">
									{gist.description || "No description"}
								</p>
								<p className="mt-1 text-xs text-bjork-text-muted">
									<Link
										to="/$owner"
										params={{ owner: gist.owner.username }}
										className="hover:underline"
									>
										{gist.owner.username}
									</Link>
									{" · "}
									{gist.visibility === "public" ? "Public" : "Secret"}
								</p>
							</li>
						))}
					</ul>
				</Panel>
			)}
		</div>
	);
}
