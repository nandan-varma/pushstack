import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { RepoList } from "@/components/dashboard/RepoList";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth-session";
import {
	assignedThreadsQueryOptions,
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
	// Unlike every other page in the app, this had no loader — it fetched both
	// queries client-side after hydration, meaning the dashboard (the first thing
	// most users see after logging in) always showed loading skeletons before
	// popping in content, instead of arriving with it already rendered.
	loader: async ({ context: { queryClient } }) =>
		Promise.all([
			queryClient.ensureQueryData(userRepositoriesQueryOptions()),
			queryClient.ensureQueryData(assignedThreadsQueryOptions()),
			queryClient.ensureQueryData(userActivityQueryOptions({ limit: 20 })),
		]),
});

function DashboardPage() {
	const { user } = Route.useRouteContext();
	const {
		data: assigned,
		isError: assignedError,
		refetch: refetchAssigned,
	} = useQuery(assignedThreadsQueryOptions());

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
					<h1 className="text-3xl font-bold text-foreground">
						Welcome back, {user.name.split(" ")[0]}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
				</div>
				<Link to="/repositories/new">
					<Button size="sm">+ New repository</Button>
				</Link>
			</div>

			<div className="grid gap-8 lg:grid-cols-3">
				<section className="lg:col-span-3" aria-labelledby="assigned-heading">
					<h2 id="assigned-heading" className="mb-4 text-base font-semibold">
						Assigned to you
					</h2>
					{assignedError ? (
						<div role="alert">
							Could not load assignments.{" "}
							<Button variant="ghost" onClick={() => refetchAssigned()}>
								Retry
							</Button>
						</div>
					) : assigned?.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No open issues or pull requests assigned to you.
						</p>
					) : (
						<ul className="space-y-2">
							{assigned?.map((thread) => (
								<li key={`${thread.owner}/${thread.name}/${thread.number}`}>
									<Link
										to={
											thread.kind === "issue"
												? "/repo/$owner/$name/issues/$id"
												: "/repo/$owner/$name/pulls/$id"
										}
										params={{
											owner: thread.owner,
											name: thread.name,
											id: String(thread.number),
										}}
										className="text-sm hover:underline"
									>
										{thread.title}{" "}
										<span className="text-muted-foreground">
											{thread.owner}/{thread.name} #{thread.number}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>
				{/* Repositories */}
				<div className="lg:col-span-2">
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-base font-semibold text-foreground">
							Your repositories
						</h2>
						<Link
							to="/repositories"
							className="text-xs font-medium text-primary hover:underline"
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
					<h2 className="mb-4 text-base font-semibold text-foreground">
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
