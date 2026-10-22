import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";

export type CommitListItem = {
	sha: string;
	message: string;
	authorName: string;
	createdAt: string;
};

// One grid for every row: the sha is a fixed leading column, the message takes
// the rest, and author/time ride the message line on wide screens / wrap under
// the message on narrow ones.
const rowClass =
	"grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3.5 text-left no-underline transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none md:grid-cols-[5.5rem_minmax(0,1fr)_auto]";

export function CommitList({
	owner,
	name,
	commits,
}: {
	owner: string;
	name: string;
	commits: CommitListItem[];
}) {
	return (
		<div className="island-shell divide-y divide-border overflow-hidden rounded-[20px]">
			{commits.map((commit) => (
				<Link
					key={commit.sha}
					to="/$owner/$name/commit/$sha"
					params={{ owner, name, sha: commit.sha }}
					className={rowClass}
				>
					<code className="col-start-1 row-start-1 shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground">
						{commit.sha.substring(0, 7)}
					</code>
					<p
						title={commit.message}
						className="col-start-2 row-start-1 min-w-0 truncate text-sm leading-5 font-medium text-foreground"
					>
						{commit.message.split("\n")[0]}
					</p>
					<p className="col-start-2 row-start-2 min-w-0 text-xs leading-5 break-words text-muted-foreground md:col-start-3 md:row-start-1 md:text-right md:whitespace-nowrap">
						{commit.authorName} &middot;{" "}
						{formatDistanceToNow(new Date(commit.createdAt), {
							addSuffix: true,
						})}
					</p>
				</Link>
			))}
		</div>
	);
}
