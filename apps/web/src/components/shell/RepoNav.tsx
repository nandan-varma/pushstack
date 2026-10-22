import {
	CircleDotIcon,
	CodeIcon,
	GitCompareArrowsIcon,
	HistoryIcon,
	SettingsIcon,
} from "@animateicons/react/lucide";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute, useParams } from "@tanstack/react-router";
import { CopyField } from "@/components/CopyField";
import { RepoStar } from "@/components/repo/RepoStar";
import { Skeleton } from "@/components/ui/skeleton";
import { getCloneUrl } from "@/lib/git-utils";
import {
	authSessionQueryOptions,
	repositoryByNameQueryOptions,
} from "@/lib/query-options";
import { SidebarGroup, SidebarLink } from "./SidebarLink";

/**
 * The open repository, in the sidebar: who and what it is, its sections with
 * live counts, and its clone URL — always one tap away, on every repo page.
 */
export function RepoNav({ owner, name }: { owner: string; name: string }) {
	const { data: repo, isLoading } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const { data: session } = useQuery(authSessionQueryOptions());
	const { branch } = useParams({ strict: false });
	const matchRoute = useMatchRoute();

	if (isLoading) {
		return (
			<div className="space-y-2 px-2.5">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
			</div>
		);
	}
	if (!repo) return null;

	const ref = branch ?? repo.defaultBranch;
	const codeActive = Boolean(
		matchRoute({ to: "/$owner/$name/tree/$branch/$", fuzzy: true }) ||
			matchRoute({ to: "/$owner/$name/blob/$branch/$", fuzzy: true }),
	);
	const commitsActive = Boolean(
		matchRoute({ to: "/$owner/$name/commits/$branch", fuzzy: true }) ||
			matchRoute({ to: "/$owner/$name/commit/$sha", fuzzy: true }),
	);
	const isOwner = repo.ownerId === session?.user?.id;

	return (
		<div className="space-y-3">
			<div className="px-2.5">
				<p className="truncate text-[13px] text-bjork-text-soft">
					<Link
						to="/$owner"
						params={{ owner }}
						className="hover:text-bjork-text"
					>
						{owner}
					</Link>{" "}
					/
				</p>
				<div className="mt-0.5 flex items-center gap-2">
					<Link
						to="/$owner/$name"
						params={{ owner, name }}
						className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-bjork-text hover:text-bjork-accent"
					>
						{name}
					</Link>
					<span className="shrink-0 rounded-full border border-bjork-border px-1.5 text-[11px] text-bjork-text-soft capitalize">
						{repo.visibility}
					</span>
				</div>
				{repo.description && (
					<p className="mt-1.5 line-clamp-2 text-xs leading-5 text-bjork-text-muted">
						{repo.description}
					</p>
				)}
			</div>
			<SidebarGroup>
				<SidebarLink
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: ref, _splat: "" }}
					icon={CodeIcon}
					label="Code"
					active={codeActive}
				/>
				<SidebarLink
					to="/$owner/$name/issues"
					params={{ owner, name }}
					icon={CircleDotIcon}
					label="Issues"
					count={repo.openIssueCount}
				/>
				<SidebarLink
					to="/$owner/$name/pulls"
					params={{ owner, name }}
					icon={GitCompareArrowsIcon}
					label="Pull requests"
					count={repo.openPullRequestCount}
				/>
				<SidebarLink
					to="/$owner/$name/commits/$branch"
					params={{ owner, name, branch: ref }}
					icon={HistoryIcon}
					label="Commits"
					active={commitsActive}
				/>
				{isOwner && (
					<SidebarLink
						to="/$owner/$name/settings"
						params={{ owner, name }}
						icon={SettingsIcon}
						label="Settings"
					/>
				)}
			</SidebarGroup>
			<div className="space-y-2 px-1">
				<RepoStar owner={owner} name={name} repo={repo} />
				<CopyField value={getCloneUrl(owner, name)} label="Copy clone URL" />
			</div>
		</div>
	);
}
