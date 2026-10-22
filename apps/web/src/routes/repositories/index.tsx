import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
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

const cardGrid = "grid gap-5 sm:grid-cols-2 xl:grid-cols-3";

function RepositoriesPage() {
	const {
		data: repositories,
		isLoading,
		isError,
		refetch,
	} = useQuery(userRepositoriesQueryOptions());

	return (
		<main className="page-wrap py-6 sm:py-8">
			<PageHeader
				title="Repositories"
				description="Browse and manage the repositories you can access."
				eyebrow="Your code"
				actions={
					<Button asChild>
						<Link to="/repositories/new">+ New repository</Link>
					</Button>
				}
			/>

			{isLoading ? (
				<div className={cardGrid}>
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-36" />
					))}
				</div>
			) : isError ? (
				<EmptyState
					variant="error"
					message="Couldn't load repositories."
					action={
						<Button variant="outline" onClick={() => refetch()}>
							Try again
						</Button>
					}
				/>
			) : repositories && repositories.length > 0 ? (
				<>
					<h2 className="sr-only">Repositories list</h2>
					<div className={cardGrid}>
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
