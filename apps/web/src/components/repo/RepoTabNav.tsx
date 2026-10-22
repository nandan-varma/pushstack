import { Link } from "@tanstack/react-router";
import { CircleDot, Code2, GitPullRequest, History } from "lucide-react";

import {
	segmentedRailClassName,
	segmentedItemClassName as tabLinkBase,
} from "@/components/segmented-navigation";

export function RepoTabNavSkeleton() {
	return (
		<div className="mb-7">
			<nav className="flex gap-6 p-3">
				{[16, 14, 24, 18].map((width) => (
					<div
						key={width}
						className="h-4 animate-pulse rounded bg-muted"
						style={{ width: `${width * 4}px` }}
					/>
				))}
			</nav>
		</div>
	);
}

export function RepoTabNav({
	owner,
	name,
	currentBranch,
	isCodeActive,
	isCommitsActive,
}: {
	owner: string;
	name: string;
	currentBranch: string;
	isCodeActive: boolean;
	isCommitsActive: boolean;
}) {
	return (
		<div className="mb-7">
			<nav aria-label="Repository" className={segmentedRailClassName}>
				<Link
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: currentBranch, _splat: "" }}
					className={isCodeActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
				>
					<Code2 className="size-4" aria-hidden="true" />
					Code
				</Link>
				<Link
					to="/$owner/$name/issues"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
				>
					<CircleDot className="size-4" aria-hidden="true" />
					Issues
				</Link>
				<Link
					to="/$owner/$name/pulls"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
				>
					<GitPullRequest className="size-4" aria-hidden="true" />
					Pull requests
				</Link>
				<Link
					to="/$owner/$name/commits/$branch"
					params={{ owner, name, branch: currentBranch }}
					className={isCommitsActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
				>
					<History className="size-4" aria-hidden="true" />
					Commits
				</Link>
			</nav>
		</div>
	);
}
