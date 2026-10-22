import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/utils/avatar";

interface LatestCommit {
	sha: string;
	message: string;
	authorName?: string | null;
	createdAt: string;
}

/**
 * The latest commit on the viewed ref, laid out as the file list's header
 * row: who, what, the short sha, when, and the way into the full history.
 */
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
			<div className="flex w-full items-center gap-3" aria-busy="true">
				<Skeleton className="size-6 shrink-0 rounded-full" />
				<Skeleton className="h-3.5 w-20 shrink-0" />
				<Skeleton className="h-3.5 w-64 max-w-full" />
				<Skeleton className="ml-auto h-3 w-24 shrink-0" />
			</div>
		);
	}

	if (!commit) return null;

	const subject = commit.message.split("\n")[0];

	return (
		<div className="flex w-full min-w-0 items-center gap-3">
			<Avatar size="sm" className="shrink-0">
				<AvatarFallback className="text-[11px]">
					{getInitials(commit.authorName || "U")}
				</AvatarFallback>
			</Avatar>
			<span className="hidden shrink-0 text-sm font-medium text-bjork-text sm:inline">
				{commit.authorName || "Unknown"}
			</span>
			<Link
				to="/$owner/$name/commit/$sha"
				params={{ owner, name, sha: commit.sha }}
				title={commit.message}
				className="min-w-0 truncate text-sm text-bjork-text-muted hover:text-bjork-text"
			>
				{subject}
			</Link>
			<div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-bjork-text-soft">
				<Link
					to="/$owner/$name/commit/$sha"
					params={{ owner, name, sha: commit.sha }}
					className="hidden font-mono tabular-nums hover:text-bjork-text sm:inline"
				>
					{commit.sha.slice(0, 7)}
				</Link>
				<RelativeTime date={commit.createdAt} className="hidden sm:inline" />
				<Link
					to="/$owner/$name/commits/$branch"
					params={{ owner, name, branch }}
					className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 font-medium text-bjork-text-medium transition-[background-color,color] duration-150 hover:bg-bjork-surface-hover hover:text-bjork-text"
				>
					<History aria-hidden="true" className="size-3.5" />
					History
				</Link>
			</div>
		</div>
	);
}
