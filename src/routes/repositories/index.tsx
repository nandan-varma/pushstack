import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import { getSession } from "@/lib/auth-session";
import { userRepositoriesQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/repositories/")({
	component: RepositoriesPage,
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
		return { user: session.user };
	},
});

function RepositoriesPage() {
	const {
		data: repositories,
		isLoading,
		isError,
		refetch,
	} = useQuery(userRepositoriesQueryOptions());

	return (
		<main className="page-wrap px-4 py-10">
			<div className="mb-8 flex items-center justify-between gap-4">
				<div>
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						Repositories
					</h1>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						Browse and manage the repositories you can access.
					</p>
				</div>
				<Link to="/repositories/new">
					<Button size="sm">+ New repository</Button>
				</Link>
			</div>

			{isLoading ? (
				<div className="grid gap-3 md:grid-cols-2">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-28" />
					))}
				</div>
			) : isError ? (
				<EmptyState
					variant="error"
					message="Couldn't load repositories."
					action={
						<Button size="sm" variant="outline" onClick={() => refetch()}>
							Try again
						</Button>
					}
				/>
			) : repositories && repositories.length > 0 ? (
				<div className="grid gap-3 md:grid-cols-2">
					{repositories.map((repo) => {
						const ownerUsername = repo.owner?.username || "unknown";

						return (
							<Link
								key={repo.id}
								to="/repo/$owner/$name/tree/$branch/$"
								params={{
									owner: ownerUsername,
									name: repo.name,
									branch: repo.defaultBranch || "main",
									_splat: "",
								}}
								className="island-shell feature-card block rounded-xl p-5 no-underline"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h2
												title={`${ownerUsername}/${repo.name}`}
												className="truncate text-sm font-semibold text-[var(--lagoon-deep)]"
											>
												{ownerUsername}/{repo.name}
											</h2>
											<VisibilityBadge visibility={repo.visibility} />
										</div>
										<p className="mt-1 line-clamp-2 text-xs text-[var(--sea-ink-soft)]">
											{repo.description || "No description"}
										</p>
									</div>
									<span className="shrink-0 text-xs text-[var(--sea-ink-soft)]">
										{new Date(repo.updatedAt).toLocaleDateString()}
									</span>
								</div>
							</Link>
						);
					})}
				</div>
			) : (
				<EmptyState
					message="No repositories yet."
					action={
						<Link to="/repositories/new">
							<Button size="sm">Create your first repository</Button>
						</Link>
					}
				/>
			)}
		</main>
	);
}
