import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { RepoList } from "@/components/dashboard/RepoList";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth-session";
import {
	userActivityQueryOptions,
	userRepositoriesQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/dashboard")({
	component: DashboardPage,
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
		return { user: session.user };
	},
});

function DashboardPage() {
	const { user } = Route.useRouteContext();

	const {
		data: repositories,
		isLoading: reposLoading,
		isError: reposError,
		refetch: refetchRepos,
	} = useQuery(userRepositoriesQueryOptions());

	const {
		data: activities,
		isLoading: activitiesLoading,
		isError: activitiesError,
		refetch: refetchActivities,
	} = useQuery(userActivityQueryOptions({ limit: 20 }));

	return (
		<div className="page-wrap px-4 py-10">
			{/* Welcome */}
			<div className="mb-8 flex items-center justify-between gap-4">
				<div>
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						Welcome back, {user.name.split(" ")[0]}
					</h1>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						{user.email}
					</p>
				</div>
				<Link to="/repositories/new">
					<Button size="sm">+ New repository</Button>
				</Link>
			</div>

			<div className="grid gap-8 lg:grid-cols-3">
				{/* Repositories */}
				<div className="lg:col-span-2">
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-base font-semibold text-[var(--sea-ink)]">
							Your repositories
						</h2>
						<Link
							to="/repositories"
							className="text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
						>
							View all
						</Link>
					</div>
					<RepoList
						repos={repositories}
						isLoading={reposLoading}
						isError={reposError}
						onRetry={() => refetchRepos()}
					/>
				</div>

				{/* Activity */}
				<div>
					<h2 className="mb-4 text-base font-semibold text-[var(--sea-ink)]">
						Recent activity
					</h2>
					<ActivityFeed
						activities={activities}
						isLoading={activitiesLoading}
						isError={activitiesError}
						onRetry={() => refetchActivities()}
					/>
				</div>
			</div>
		</div>
	);
}
