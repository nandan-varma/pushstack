import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils/avatar";

export type CommitListItem = {
	sha: string;
	message: string;
	authorName: string;
	createdAt: string;
};

/** A bordered list of commits, each linking to its commit page. */
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
		<div className="overflow-hidden rounded-xl border border-border">
			{commits.map((commit, idx) => (
				<Link
					key={commit.sha}
					to="/$owner/$name/commit/$sha"
					params={{ owner, name, sha: commit.sha }}
					className={`flex w-full items-center gap-4 px-4 py-3.5 text-left no-underline transition hover:bg-card ${idx < commits.length - 1 ? "border-b border-border" : ""}`}
				>
					<Avatar className="h-8 w-8 shrink-0">
						<AvatarFallback className="text-xs">
							{getInitials(commit.authorName)}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1 space-y-1">
						<p
							title={commit.message}
							className="truncate text-sm font-medium leading-snug text-foreground"
						>
							{commit.message.split("\n")[0]}
						</p>
						<p className="text-xs leading-snug text-muted-foreground">
							{commit.authorName} &middot;{" "}
							{formatDistanceToNow(new Date(commit.createdAt), {
								addSuffix: true,
							})}
						</p>
					</div>
					<code className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
						{commit.sha.substring(0, 7)}
					</code>
				</Link>
			))}
		</div>
	);
}
