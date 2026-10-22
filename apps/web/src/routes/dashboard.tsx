import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { CircleCheck, CircleDot, GitPullRequest, Plus } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { RepositoryList } from "@/components/repo/RepositoryList";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
	const {
		data: assigned,
		isLoading: assignedLoading,
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
		<div className="page-wrap space-y-5 py-6">
			<PageHeader title="Dashboard" />

			<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
				<div className="min-w-0 space-y-5">
					<AssignedPanel
						threads={assigned}
						isLoading={assignedLoading}
						isError={assignedError}
						onRetry={() => refetchAssigned()}
					/>
					<ActivityFeed
						activities={activities}
						isLoading={activitiesLoading}
						isError={activitiesError}
						onRetry={() => refetchActivities()}
					/>
				</div>
				<RepositoryList
					title="Your repositories"
					action={
						<Link
							to="/repositories"
							className="text-xs font-medium text-bjork-text-muted hover:text-bjork-text"
						>
							View all
						</Link>
					}
					repos={repositories?.slice(0, 12)}
					isLoading={reposLoading}
					isError={reposError}
					onRetry={() => refetchRepos()}
					compact
					empty={
						<EmptyState
							bare
							message="Nothing here yet."
							action={
								<Link to="/repositories/new" className={buttonVariants()}>
									<Plus aria-hidden="true" />
									New repository
								</Link>
							}
						/>
					}
				/>
			</div>
		</div>
	);
}

/** Open issues and pull requests assigned to the viewer: the work queue. */
function AssignedPanel({
	threads,
	isLoading,
	isError,
	onRetry,
}: {
	threads?: AssignedThread[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry: () => void;
}) {
	return (
		<Panel>
			<PanelHeader
				title="Assigned to you"
				actions={
					threads?.length ? (
						<span className="font-mono text-xs text-bjork-text-soft tabular-nums">
							{threads.length}
						</span>
					) : undefined
				}
			/>
			{isLoading ? (
				<div className="px-4 py-3" aria-busy="true">
					<Skeleton className="h-4 w-2/3" />
				</div>
			) : isError ? (
				<div
					role="alert"
					className="flex items-center gap-2 px-4 py-3 text-sm text-destructive"
				>
					Couldn't load assignments.
					<Button variant="ghost" size="sm" onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : !threads?.length ? (
				<p className="flex items-center gap-2 px-4 py-3.5 text-sm text-bjork-text-muted">
					<CircleCheck aria-hidden="true" className="size-4 text-success" />
					Nothing assigned to you. You're all caught up.
				</p>
			) : (
				<ul className="divide-y divide-bjork-border-muted">
					{threads.map((thread) => {
						const Icon = thread.kind === "issue" ? CircleDot : GitPullRequest;
						const updatedAt = new Date(thread.updatedAt);
						return (
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
									className="flex min-h-11 items-center gap-3 px-4 py-2 transition-[background-color] duration-150 hover:bg-bjork-surface-hover"
								>
									<Icon
										aria-hidden="true"
										className="size-4 shrink-0 text-success"
									/>
									<span className="min-w-0 flex-1 truncate text-sm text-bjork-text">
										{thread.title}
										<span className="ml-1.5 text-bjork-text-soft">
											{thread.owner}/{thread.name}#{thread.number}
										</span>
									</span>
									<time
										dateTime={updatedAt.toISOString()}
										className="shrink-0 text-xs text-bjork-text-soft tabular-nums"
									>
										{formatDistanceToNowStrict(updatedAt)}
									</time>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</Panel>
	);
}
