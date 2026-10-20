import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { RepositoryCard } from "@/components/repo/RepositoryCard";
import { RepositoryListEmptyState } from "@/components/repo/RepositoryListEmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
	loader: async ({ context: { queryClient } }) =>
		queryClient.ensureQueryData(userRepositoriesQueryOptions()),
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
					<h1 className="text-3xl font-bold text-foreground">Repositories</h1>
					<p className="mt-1 text-sm text-muted-foreground">
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
				<>
					<h2 className="sr-only">Repositories list</h2>
					<div className="grid gap-3 md:grid-cols-2">
						{repositories.map((repo) => (
							<RepositoryCard key={repo.id} repo={repo} />
						))}
					</div>
				</>
			) : (
				<RepositoryListEmptyState />
			)}
		</main>
	);
}
