import { Link } from "@tanstack/react-router";

const tabLinkBase =
	"border-b-2 border-transparent pb-3 text-sm font-medium text-[var(--sea-ink-soft)] transition hover:text-[var(--sea-ink)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]";

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
		<div className="mb-6 border-b border-[var(--line)]">
			<nav className="flex gap-6">
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
