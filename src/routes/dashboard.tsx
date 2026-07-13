import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-session";
import {
	userActivityQueryOptions,
	userRepositoriesQueryOptions,
} from "@/lib/query-options";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";

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

function describeActivity(activity: {
	type: string;
	metadata: unknown;
	repository?: { name: string; owner?: { username?: string } | null } | null;
	id: number;
}): {
	text: string;
	showRepo: boolean;
	linkTo?: string;
	linkParams?: Record<string, string>;
} {
	const meta = (activity.metadata ?? {}) as Record<string, unknown>;
	const title = typeof meta.title === "string" ? meta.title : null;
	const action = typeof meta.action === "string" ? meta.action : null;
	const repoOwner = activity.repository?.owner?.username || "unknown";
	const repoName = activity.repository?.name || "";
	const repoParams = { owner: repoOwner, name: repoName };

	switch (activity.type) {
		case "create_repo":
			return {
				text: "Created this repository",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "star":
			return {
				text: "Starred",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "commit":
			return {
				text:
					typeof meta.message === "string"
						? `Pushed a commit: "${meta.message}"`
						: "Pushed a commit",
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		case "issue": {
			const issueId = typeof meta.issueId === "number" ? meta.issueId : null;
			return {
				text: `${action === "closed" ? "Closed" : action === "reopened" ? "Reopened" : "Opened"} issue${title ? ` "${title}"` : ""}`,
				showRepo: true,
				linkTo: issueId
					? "/repo/$owner/$name/issues/$id"
					: "/repo/$owner/$name/issues",
				linkParams: issueId
					? { ...repoParams, id: String(issueId) }
					: repoParams,
			};
		}
		case "pr": {
			const prId = typeof meta.prId === "number" ? meta.prId : null;
			return {
				text: `${action === "merged" ? "Merged" : action === "closed" ? "Closed" : "Opened"} pull request${title ? ` "${title}"` : ""}`,
				showRepo: true,
				linkTo: prId
					? "/repo/$owner/$name/pulls/$id"
					: "/repo/$owner/$name/pulls",
				linkParams: prId ? { ...repoParams, id: String(prId) } : repoParams,
			};
		}
		case "comment":
			return {
				text: `Commented on ${meta.prId ? "a pull request" : "an issue"}`,
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
		default:
			return {
				text: activity.type,
				showRepo: true,
				linkTo: "/repo/$owner/$name",
				linkParams: repoParams,
			};
	}
}

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

					{reposLoading ? (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<Skeleton key={i} className="h-24" />
							))}
						</div>
					) : reposError ? (
						<div className="island-shell rounded-xl p-12 text-center">
							<p className="mb-4 text-sm text-red-600 dark:text-red-400">
								Couldn't load your repositories.
							</p>
							<Button
								size="sm"
								variant="outline"
								onClick={() => refetchRepos()}
							>
								Try again
							</Button>
						</div>
					) : repositories && repositories.length > 0 ? (
						<div className="space-y-3">
							{repositories.map((repo) => {
								const ownerUsername = repo.owner?.username || "unknown";
								return (
									<Link
										key={repo.id}
										to="/repo/$owner/$name"
										params={{ owner: ownerUsername, name: repo.name }}
										className="island-shell feature-card block rounded-xl p-5 no-underline"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<h3
														title={`${ownerUsername}/${repo.name}`}
														className="truncate text-sm font-semibold text-[var(--lagoon-deep)]"
													>
														{ownerUsername}/{repo.name}
													</h3>
													<span
														className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
															repo.visibility === "public"
																? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
																: "border-[var(--line)] text-[var(--sea-ink-soft)]"
														}`}
													>
														{repo.visibility}
													</span>
												</div>
												{repo.description && (
													<p className="mt-1 line-clamp-1 text-xs text-[var(--sea-ink-soft)]">
														{repo.description}
													</p>
												)}
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
						<div className="island-shell rounded-xl p-12 text-center">
							<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
								No repositories yet.
							</p>
							<Link to="/repositories/new">
								<Button size="sm">Create your first repository</Button>
							</Link>
						</div>
					)}
				</div>

				{/* Activity */}
				<div>
					<h2 className="mb-4 text-base font-semibold text-[var(--sea-ink)]">
						Recent activity
					</h2>

					{activitiesLoading ? (
						<div className="space-y-2">
							{[1, 2, 3, 4].map((i) => (
								<Skeleton key={i} className="h-16" />
							))}
						</div>
					) : activitiesError ? (
						<div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
							<p className="mb-3 text-xs text-red-600 dark:text-red-400">
								Couldn't load recent activity.
							</p>
							<Button
								size="sm"
								variant="outline"
								onClick={() => refetchActivities()}
							>
								Try again
							</Button>
						</div>
					) : activities && activities.length > 0 ? (
						<div className="space-y-2">
							{activities.map((activity) => {
								const { text, showRepo, linkTo, linkParams } =
									describeActivity(activity);
								const content = (
									<>
										<div className="text-xs font-medium text-[var(--sea-ink)]">
											{text}
											{showRepo && activity.repository && (
												<span className="ml-1 font-normal text-[var(--sea-ink-soft)]">
													in {activity.repository.owner?.username || "unknown"}/
													{activity.repository.name}
												</span>
											)}
										</div>
										<div className="mt-0.5 text-[10px] text-[var(--sea-ink-soft)]">
											{new Date(activity.createdAt).toLocaleString()}
										</div>
									</>
								);

								if (linkTo && linkParams) {
									return (
										<Link
											key={activity.id}
											to={linkTo}
											params={linkParams}
											className="block rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 no-underline transition hover:bg-[var(--surface-strong)]"
										>
											{content}
										</Link>
									);
								}

								return (
									<div
										key={activity.id}
										className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
									>
										{content}
									</div>
								);
							})}
						</div>
					) : (
						<div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
							<p className="text-xs text-[var(--sea-ink-soft)]">
								No recent activity
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
