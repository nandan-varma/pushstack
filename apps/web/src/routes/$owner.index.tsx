import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { BookMarked, CalendarDays } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { EmptyState } from "@/components/EmptyState";
import { NotFoundCard } from "@/components/NotFoundCard";
import { RepositoryList } from "@/components/repo/RepositoryList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { userProfileQueryOptions } from "@/lib/query-options";
import { SITE_URL } from "@/lib/site";
import { getInitials } from "@/lib/utils/avatar";

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
		<div className="page-wrap py-6 sm:py-8">
			<NotFoundCard
				title="User not found"
				message={`No user named "${username}" exists.`}
				backTo="/"
				backLabel="Back to home"
			/>
		</div>
	);
}

function UserProfilePage() {
	const { owner: username } = Route.useParams();
	const profile = useQuery(userProfileQueryOptions(username));

	if (profile.isLoading) {
		return (
			<div className="page-wrap py-6">
				<div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
					<Skeleton className="h-64" />
					<div className="space-y-5">
						<Skeleton className="h-48" />
						<Skeleton className="h-64" />
					</div>
				</div>
			</div>
		);
	}

	if (!profile.data) return <UserNotFound />;

	const { user, isSelf, repositories, activities } = profile.data;
	const handle = user.displayUsername || user.username || username;

	return (
		<div className="page-wrap py-6">
			<div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
				<aside className="flex items-center gap-4 lg:sticky lg:top-6 lg:block">
					<Avatar className="size-16 shrink-0 text-xl lg:mb-4 lg:size-[120px] lg:text-4xl">
						{user.image && <AvatarImage src={user.image} alt="" />}
						<AvatarFallback>{getInitials(user.name)}</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-bjork-text">
							{user.name}
						</h1>
						<p className="truncate text-sm text-bjork-text-soft">@{handle}</p>
						<dl className="mt-3 space-y-1.5 text-[13px] text-bjork-text-muted">
							<div className="flex items-center gap-2">
								<CalendarDays
									aria-hidden="true"
									className="size-4 text-bjork-text-soft"
								/>
								<dt className="sr-only">Joined</dt>
								<dd>Joined {format(new Date(user.createdAt), "MMMM yyyy")}</dd>
							</div>
							<div className="flex items-center gap-2">
								<BookMarked
									aria-hidden="true"
									className="size-4 text-bjork-text-soft"
								/>
								<dt className="sr-only">
									{isSelf ? "Repositories" : "Public repositories"}
								</dt>
								<dd>
									<span className="font-medium text-bjork-text tabular-nums">
										{repositories.length}
									</span>{" "}
									{isSelf ? "" : "public "}
									{repositories.length === 1 ? "repository" : "repositories"}
								</dd>
							</div>
						</dl>
						{isSelf && (
							<Link
								to="/settings"
								className={buttonVariants({
									variant: "outline",
									size: "sm",
									className: "mt-4 lg:w-full",
								})}
							>
								Edit profile
							</Link>
						)}
					</div>
				</aside>

				<div className="min-w-0 space-y-5">
					<RepositoryList
						title="Repositories"
						repos={repositories}
						showOwner={false}
						empty={
							<EmptyState
								bare
								message={
									isSelf
										? "You don't have any repositories yet."
										: `${user.name} has no public repositories yet.`
								}
								action={
									isSelf ? (
										<Link to="/repositories/new" className={buttonVariants()}>
											New repository
										</Link>
									) : undefined
								}
							/>
						}
					/>
					<ActivityFeed activities={activities} />
				</div>
			</div>
		</div>
	);
}
