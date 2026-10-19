import { Link } from "@tanstack/react-router";

const tabLinkBase =
	"shrink-0 border-b-2 border-transparent pb-3 text-sm font-medium text-muted-foreground transition hover:text-foreground [&.active]:border-primary [&.active]:text-primary";

export function RepoTabNavSkeleton() {
	return (
		<div className="mb-6 border-b border-border">
			<nav className="flex gap-6 pb-3">
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
		<div className="mb-6 border-b border-border">
			<nav className="flex gap-6 overflow-x-auto">
				<Link
					to="/repo/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: currentBranch, _splat: "" }}
					className={isCodeActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
				>
					Code
				</Link>
				<Link
					to="/repo/$owner/$name/issues"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
				>
					Issues
				</Link>
				<Link
					to="/repo/$owner/$name/pulls"
					params={{ owner, name }}
					className={tabLinkBase}
					activeProps={{ className: "active" }}
				>
					Pull Requests
				</Link>
				<Link
					to="/repo/$owner/$name/commits/$branch"
					params={{ owner, name, branch: currentBranch }}
					className={isCommitsActive ? `${tabLinkBase} active` : tabLinkBase}
					activeProps={{ className: "active" }}
				>
					Commits
				</Link>
			</nav>
		</div>
	);
}
