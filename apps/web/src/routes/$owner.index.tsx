import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { EmptyState } from "@/components/EmptyState";
import { NotFoundCard } from "@/components/NotFoundCard";
import { RepositoryCard } from "@/components/repo/RepositoryCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { userProfileQueryOptions } from "@/lib/query-options";
import { SITE_URL } from "@/lib/site";

export const Route = createFileRoute("/$owner/")({
	head: ({ params }) => {
		const title = `${params.owner}`;
		const url = `${SITE_URL}/${params.owner}`;
		return {
			meta: [
				{ title: `${title} · PushStack` },
				{
					name: "description",
					content: `${title}'s repositories and activity on PushStack.`,
				},
				{ property: "og:title", content: title },
				{ property: "og:url", content: url },
			],
			links: [{ rel: "canonical", href: url }],
		};
	},
	component: UserProfilePage,
	notFoundComponent: UserNotFound,
	loader: ({ context: { queryClient }, params }) =>
		queryClient.ensureQueryData(userProfileQueryOptions(params.owner)),
});

function UserNotFound() {
	const { owner: username } = Route.useParams();
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

function UserProfilePage() {
	const { owner: username } = Route.useParams();
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

	if (!profile.data) return <UserNotFound />;

	const { user, isSelf, repositories, activities } = profile.data;
	const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
	});

	return (
		<main className="page-wrap px-4 py-10">
			<div className="grid gap-8 lg:grid-cols-3">
				<div>
					<div className="island-shell rounded-xl p-6">
						<Avatar className="h-20 w-20 text-2xl">
							{user.image && <AvatarImage src={user.image} alt={user.name} />}
							<AvatarFallback>
								{user.name.charAt(0).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<h1 className="mt-4 text-2xl font-bold text-foreground">
							{user.name}
						</h1>
						<p className="text-sm text-muted-foreground">
							@{user.displayUsername || user.username || username}
						</p>
						<dl className="mt-4 space-y-1 text-xs text-muted-foreground">
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

				<div className="space-y-8 lg:col-span-2">
					<section>
						<h2 className="mb-4 text-base font-semibold text-foreground">
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
								{repositories.map((repo) => (
									<RepositoryCard key={repo.id} repo={repo} showOwner={false} />
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-4 text-base font-semibold text-foreground">
							Recent activity
						</h2>
						<ActivityFeed activities={activities} />
					</section>
				</div>
			</div>
		</main>
	);
}
