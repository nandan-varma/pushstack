import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { BookMarked, CalendarDays } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { EmptyState } from "@/components/EmptyState";
import {
	Panel,
	PanelHeader,
	PanelList,
	PanelRow,
} from "@/components/layout/panel";
import { NotFoundCard } from "@/components/NotFoundCard";
import { FollowButton } from "@/components/profile/FollowButton";
import { RepositoryList } from "@/components/repo/RepositoryList";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	profileConnectionsQueryOptions,
	userProfileQueryOptions,
} from "@/lib/query-options";
import { SITE_URL } from "@/lib/site";
import { getInitials } from "@/lib/utils/avatar";

type ProfileTab = "followers" | "following";

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
	validateSearch: (search: Record<string, unknown>): { tab?: ProfileTab } => ({
		tab:
			search.tab === "followers" || search.tab === "following"
				? search.tab
				: undefined,
	}),
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
	const { tab } = Route.useSearch();
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

	const {
		user,
		isSelf,
		repositories,
		activities,
		followers,
		following,
		isFollowing,
	} = profile.data;
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
						<p className="mt-3 flex gap-3 text-[13px] text-bjork-text-muted">
							<Link
								to="/$owner"
								params={{ owner: username }}
								search={{ tab: "followers" }}
								className="hover:text-bjork-text"
							>
								<span className="font-medium text-bjork-text tabular-nums">
									{followers}
								</span>{" "}
								{followers === 1 ? "follower" : "followers"}
							</Link>
							<Link
								to="/$owner"
								params={{ owner: username }}
								search={{ tab: "following" }}
								className="hover:text-bjork-text"
							>
								<span className="font-medium text-bjork-text tabular-nums">
									{following}
								</span>{" "}
								following
							</Link>
						</p>
						{!isSelf && (
							<FollowButton username={user.username} following={isFollowing} />
						)}
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
					{tab ? (
						<ConnectionList username={username} kind={tab} />
					) : (
						<>
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
												<Link to="/new" className={buttonVariants()}>
													New repository
												</Link>
											) : undefined
										}
									/>
								}
							/>
							<ActivityFeed activities={activities} />
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/** The `?tab=followers` / `?tab=following` list: public fields only. */
function ConnectionList({
	username,
	kind,
}: {
	username: string;
	kind: ProfileTab;
}) {
	const { data, isLoading } = useQuery(
		profileConnectionsQueryOptions(username, kind),
	);
	return (
		<Panel>
			<PanelHeader title={kind === "followers" ? "Followers" : "Following"} />
			{isLoading ? (
				<div className="px-4 py-3" aria-busy="true">
					<Skeleton className="h-4 w-1/2" />
				</div>
			) : data && data.users.length > 0 ? (
				<PanelList>
					{data.users.map((person) => (
						<PanelRow key={person.username}>
							<Link
								to="/$owner"
								params={{ owner: person.username }}
								className="flex items-center gap-3 text-sm text-bjork-text hover:underline"
							>
								<Avatar className="size-8">
									{person.image && <AvatarImage src={person.image} alt="" />}
									<AvatarFallback>{getInitials(person.name)}</AvatarFallback>
								</Avatar>
								<span className="font-medium">{person.name}</span>
								<span className="text-bjork-text-soft">@{person.username}</span>
							</Link>
						</PanelRow>
					))}
				</PanelList>
			) : (
				<EmptyState
					bare
					message={
						kind === "followers"
							? `${username} has no followers yet.`
							: `${username} isn't following anyone yet.`
					}
				/>
			)}
		</Panel>
	);
}
