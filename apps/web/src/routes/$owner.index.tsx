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
		<main className="page-wrap py-6 sm:py-8">
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
			<main className="page-wrap py-6 sm:py-8">
				<div className="space-y-5">
					<Skeleton className="h-40" />
					<div className="grid gap-5 sm:grid-cols-2">
						{[1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-32" />
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

	const initials = user.name.charAt(0).toUpperCase();

	return (
		<main className="page-wrap py-6 sm:py-8">
			<div className="space-y-5">
				<header className="island-shell flex flex-col gap-4 rounded-[20px] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
					<div className="flex min-w-0 items-start gap-4">
						<Avatar className="h-20 w-20 shrink-0 text-2xl">
							{user.image && <AvatarImage src={user.image} alt={user.name} />}
							<AvatarFallback>{initials}</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
								{user.name}
							</h1>
							<p className="truncate text-sm text-muted-foreground">
								@{user.displayUsername || user.username || username}
							</p>
							<dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
								<div className="flex items-center gap-1.5">
									<dt>Joined</dt>
									<dd className="font-medium text-foreground">{joined}</dd>
								</div>
								<div className="flex items-center gap-1.5">
									<dt>{isSelf ? "Repositories" : "Public repositories"}</dt>
									<dd className="font-medium text-foreground">
										{repositories.length}
									</dd>
								</div>
							</dl>
						</div>
					</div>
					{isSelf && (
						<Button variant="outline" asChild>
							<Link to="/settings">Edit profile</Link>
						</Button>
					)}
				</header>

				<section>
					<h2 className="mb-3 text-base font-semibold text-foreground">
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
										<Button>Create a repository</Button>
									</Link>
								) : undefined
							}
						/>
					) : (
						<div className="grid auto-rows-fr gap-5 sm:grid-cols-2">
							{repositories.map((repo) => (
								<RepositoryCard key={repo.id} repo={repo} showOwner={false} />
							))}
						</div>
					)}
				</section>

				<section>
					<h2 className="mb-3 text-base font-semibold text-foreground">
						Recent activity
					</h2>
					<ActivityFeed activities={activities} />
				</section>
			</div>
		</main>
	);
}
