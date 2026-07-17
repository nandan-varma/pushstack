import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { EmptyState } from "@/components/EmptyState";
import { NotFoundCard } from "@/components/NotFoundCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@/components/ui/visibility-badge";
import { userProfileQueryOptions } from "@/lib/query-options";

export const Route = createFileRoute("/users/$username")({
	component: UserProfilePage,
	loader: async ({ context: { queryClient }, params }) => {
		// Swallow the not-found error here so SSR still renders the page shell;
		// the component shows the NotFoundCard from the query state.
		await queryClient
			.ensureQueryData(userProfileQueryOptions(params.username))
			.catch(() => undefined);
	},
});

function UserProfilePage() {
	const { username } = Route.useParams();
	const profile = useQuery(userProfileQueryOptions(username));

	if (profile.isLoading) {
		return (
			<main className="page-wrap px-4 py-10">
				<div className="grid gap-8 lg:grid-cols-3">
					<Skeleton className="h-56" />
					<div className="space-y-3 lg:col-span-2">
						{[1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-24" />
						))}
					</div>
				</div>
			</main>
		);
	}

	if (profile.isError || !profile.data) {
		return (
			<main className="page-wrap px-4 py-10">
				<NotFoundCard
					title="User not found"
					message={`No user named "${username}" exists.`}
					backTo="/"
					backLabel="Back to home"
				/>
			</main>
		);
	}

	const { user, isSelf, repositories, activities } = profile.data;
	const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
	});

	return (
		<main className="page-wrap px-4 py-10">
			<div className="grid gap-8 lg:grid-cols-3">
				{/* Profile card */}
				<div>
					<div className="island-shell rounded-xl p-6">
						<Avatar className="h-20 w-20 text-2xl">
							{user.image && <AvatarImage src={user.image} alt={user.name} />}
							<AvatarFallback>
								{user.name.charAt(0).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<h1 className="display-title mt-4 text-2xl font-bold text-[var(--sea-ink)]">
							{user.name}
						</h1>
						<p className="text-sm text-[var(--sea-ink-soft)]">
							@{user.displayUsername || user.username || username}
						</p>
						<dl className="mt-4 space-y-1 text-xs text-[var(--sea-ink-soft)]">
							<div className="flex justify-between">
								<dt>Joined</dt>
								<dd>{joined}</dd>
							</div>
							<div className="flex justify-between">
								<dt>{isSelf ? "Repositories" : "Public repositories"}</dt>
								<dd>{repositories.length}</dd>
							</div>
						</dl>
						{isSelf && (
							<Link to="/settings" className="mt-4 inline-block">
								<Button size="sm" variant="outline">
									Edit profile
								</Button>
							</Link>
						)}
					</div>
				</div>

				{/* Repositories + activity */}
				<div className="space-y-8 lg:col-span-2">
					<section>
						<h2 className="mb-4 text-base font-semibold text-[var(--sea-ink)]">
							Repositories
						</h2>
						{repositories.length === 0 ? (
							<EmptyState
								message={
									isSelf
										? "You don't have any repositories yet."
										: `${user.name} has no public repositories yet.`
								}
								action={
									isSelf ? (
										<Link to="/repositories/new">
											<Button size="sm">Create a repository</Button>
										</Link>
									) : undefined
								}
							/>
						) : (
							<div className="grid gap-3 md:grid-cols-2">
								{repositories.map((repo) => {
									const ownerUsername = repo.owner?.username || username;
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
														<h3
															title={repo.name}
															className="truncate text-sm font-semibold text-[var(--lagoon-deep)]"
														>
															{repo.name}
														</h3>
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
						)}
					</section>

					<section>
						<h2 className="mb-4 text-base font-semibold text-[var(--sea-ink)]">
							Recent activity
						</h2>
						<ActivityFeed activities={activities} />
					</section>
				</div>
			</div>
		</main>
	);
}
