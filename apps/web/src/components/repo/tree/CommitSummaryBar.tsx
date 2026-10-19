import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils/avatar";

interface LatestCommit {
	sha: string;
	message: string;
	authorName?: string | null;
	createdAt: string;
}

export function CommitSummaryBar({
	owner,
	name,
	branch,
	commit,
	isLoading,
}: {
	owner: string;
	name: string;
	branch: string;
	commit?: LatestCommit;
	isLoading?: boolean;
}) {
	if (isLoading) {
		return (
			<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-2.5">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-muted" />
					<div className="h-3.5 w-20 shrink-0 animate-pulse rounded bg-muted" />
					<div className="h-3.5 w-64 max-w-full animate-pulse rounded bg-muted" />
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<div className="h-3 w-16 animate-pulse rounded bg-muted" />
					<div className="h-3 w-12 animate-pulse rounded bg-muted" />
				</div>
			</div>
		);
	}

	if (!commit) return null;

	const subject = commit.message.split("\n")[0];

	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-2.5">
			<div className="flex min-w-0 items-center gap-2.5">
				<Avatar className="h-6 w-6 shrink-0">
					<AvatarFallback className="text-[10px]">
						{getInitials(commit.authorName || "U")}
					</AvatarFallback>
				</Avatar>
				<span className="shrink-0 text-sm font-medium text-foreground">
					{commit.authorName || "Unknown"}
				</span>
				<Link
					to="/repo/$owner/$name/commit/$sha"
					params={{ owner, name, sha: commit.sha }}
					title={commit.message}
					className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
				>
					{subject}
				</Link>
			</div>
			<div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
				<span>
					{formatDistanceToNow(new Date(commit.createdAt), {
						addSuffix: true,
					})}
				</span>
				<Link
					to="/repo/$owner/$name/commits/$branch"
					params={{ owner, name, branch }}
					className="font-medium text-primary hover:underline"
				>
					History
				</Link>
			</div>
		</div>
	);
}
