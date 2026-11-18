import { Link } from "@tanstack/react-router";
import { GitFork } from "lucide-react";

/**
 * "forked from owner/name" under the repository name, with a link to the
 * forks list. Rendered only when the repository is a fork of one the viewer
 * can read; an unreadable parent is never named.
 */
export function ForkedFrom({
	owner,
	name,
	parent,
	forksCount,
}: {
	owner: string;
	name: string;
	parent?: { name: string; owner: { username: string } } | null;
	forksCount: number;
}) {
	if (!parent && forksCount === 0) return null;
	return (
		<p className="mt-1 text-xs leading-5 text-bjork-text-soft">
			{parent && (
				<>
					forked from{" "}
					<Link
						to="/$owner/$name"
						params={{ owner: parent.owner.username, name: parent.name }}
						className="hover:text-bjork-text hover:underline"
					>
						{parent.owner.username}/{parent.name}
					</Link>
				</>
			)}
			{parent && forksCount > 0 && <span aria-hidden="true"> · </span>}
			{forksCount > 0 && (
				<Link
					to="/$owner/$name/forks"
					params={{ owner, name }}
					className="inline-flex items-center gap-1 hover:text-bjork-text hover:underline"
				>
					<GitFork aria-hidden="true" className="size-3" />
					{forksCount} {forksCount === 1 ? "fork" : "forks"}
				</Link>
			)}
		</p>
	);
}
