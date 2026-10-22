import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { RepoList } from "@/components/dashboard/RepoList";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth-session";
import {
	assignedThreadsQueryOptions,
	userActivityQueryOptions,
	userRepositoriesQueryOptions,
} from "@/lib/query-options";
import type { getAssignedThreads } from "@/server/assignees";

type AssignedThread = Awaited<ReturnType<typeof getAssignedThreads>>[number];

export const Route = createFileRoute("/dashboard")({
	component: DashboardPage,
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) {
			throw redirect({ to: "/auth/login" });
		}
		return { user: session.user };
	},
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
		<div className="page-wrap py-6 sm:py-8">
			<PageHeader
				title={`Welcome back, ${user.name.split(" ")[0]}`}
				description="Your code, conversations, and next steps in one place."
				eyebrow="Your workspace"
				actions={
					<Button asChild>
						<Link to="/repositories/new">+ New repository</Link>
					</Button>
				}
			/>

			<div className="space-y-6">
				<AssignedSection
					threads={assigned}
					isError={assignedError}
					onRetry={() => refetchAssigned()}
				/>

				<div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
					<section className="min-w-0" aria-labelledby="repositories-heading">
						<div className="mb-3 flex items-baseline justify-between gap-3">
							<h2
								id="repositories-heading"
								className="text-base font-semibold text-foreground"
							>
								Your repositories
							</h2>
							<Link
								to="/repositories"
								className="shrink-0 text-xs font-medium text-primary hover:underline"
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
					</section>

					<section className="min-w-0" aria-labelledby="activity-heading">
						<div className="mb-3 flex items-baseline justify-between gap-3">
							<h2
								id="activity-heading"
								className="text-base font-semibold text-foreground"
							>
								Recent activity
							</h2>
							<Link
								to="/notifications"
								className="shrink-0 text-xs font-medium text-primary hover:underline"
							>
								View all
							</Link>
						</div>
						<ActivityFeed
							activities={activities?.slice(0, 8)}
							isLoading={activitiesLoading}
							isError={activitiesError}
							onRetry={() => refetchActivities()}
						/>
					</section>
				</div>
			</div>
		</div>
	);
}

function AssignedSection({
	threads,
	isError,
	onRetry,
}: {
	threads?: AssignedThread[];
	isError?: boolean;
	onRetry: () => void;
}) {
	const empty = !isError && threads?.length === 0;

	return (
		<section
			aria-labelledby="assigned-heading"
			className={
				empty
					? "island-shell flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[20px] px-4 py-3"
					: "island-shell rounded-[20px] p-5"
			}
		>
			<h2
				id="assigned-heading"
				className={
					empty
						? "text-sm font-semibold text-foreground"
						: "mb-2 text-sm font-semibold text-foreground"
				}
			>
				Assigned to you
			</h2>
			{isError ? (
				<div role="alert" className="flex items-center gap-2 text-sm">
					Could not load assignments.
					<Button variant="ghost" onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : empty ? (
				<p className="text-sm text-muted-foreground">
					No open issues or pull requests assigned to you.
				</p>
			) : (
				<ul className="space-y-1">
					{threads?.map((thread) => (
						<li key={`${thread.owner}/${thread.name}/${thread.number}`}>
							<Link
								to={
									thread.kind === "issue"
										? "/$owner/$name/issues/$id"
										: "/$owner/$name/pulls/$id"
								}
								params={{
									owner: thread.owner,
									name: thread.name,
									id: String(thread.number),
								}}
								className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
							>
								<span className="min-w-0 truncate">{thread.title}</span>
								<span className="text-xs text-muted-foreground">
									{thread.owner}/{thread.name} #{thread.number}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
