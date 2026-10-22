import { Link } from "@tanstack/react-router";

/** A branch name as GitHub sets it: mono, on an accent wash, linked to its tree. */
export function BranchChip({
	owner,
	name,
	branch,
}: {
	owner: string;
	name: string;
	branch: string;
}) {
	return (
		<Link
			to="/$owner/$name/tree/$branch/$"
			params={{ owner, name, branch, _splat: "" }}
			className="inline-flex h-6 max-w-64 items-center truncate rounded-[8px] bg-bjork-accent-soft px-2 font-mono text-xs text-bjork-accent-badge-foreground hover:bg-bjork-accent-muted"
		>
			{branch}
		</Link>
	);
}
