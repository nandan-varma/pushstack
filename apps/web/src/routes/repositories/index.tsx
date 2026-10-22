import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Toolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/PageHeader";
import { RepositoryList } from "@/components/repo/RepositoryList";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	const [filter, setFilter] = useState("");
	const query = useDeferredValue(filter.trim().toLowerCase());
	const shown = query
		? repositories?.filter(
				(repo) =>
					repo.name.toLowerCase().includes(query) ||
					repo.description?.toLowerCase().includes(query),
			)
		: repositories;

	return (
		<div className="page-wrap space-y-4 py-6">
			<PageHeader
				title="Repositories"
				meta={repositories ? `${repositories.length}` : undefined}
				actions={
					<Link to="/repositories/new" className={buttonVariants()}>
						<Plus aria-hidden="true" />
						New repository
					</Link>
				}
			/>
			{(repositories?.length ?? 0) > 3 && (
				<Toolbar>
					<div className="relative w-full max-w-sm">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-bjork-text-soft"
						/>
						<Input
							type="search"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Find a repository"
							aria-label="Find a repository"
							className="h-9 pl-10"
						/>
					</div>
				</Toolbar>
			)}
			<RepositoryList
				repos={shown}
				isLoading={isLoading}
				isError={isError}
				onRetry={() => refetch()}
				empty={
					query ? (
						<EmptyState bare message={`No repositories match “${filter}”.`} />
					) : (
						<EmptyState
							bare
							title="No repositories yet"
							message="Create one to start pushing code."
							action={
								<Link to="/repositories/new" className={buttonVariants()}>
									<Plus aria-hidden="true" />
									New repository
								</Link>
							}
						/>
					)
				}
			/>
		</div>
	);
}
