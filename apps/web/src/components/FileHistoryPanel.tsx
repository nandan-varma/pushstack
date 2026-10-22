import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { RelativeTime } from "@/components/RelativeTime";
import { CommitList } from "@/components/repo/CommitList";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryFileHistoryQueryOptions } from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

const PAGE_SIZE = 30;

export function FileCommitBanner({
	owner,
	name,
	repoId,
	branch,
	filePath,
	bare = false,
}: {
	owner: string;
	name: string;
	repoId: number;
	branch: string;
	filePath: string;
	/** Without its own surface, for a panel header that already has one. */
	bare?: boolean;
}) {
	const { data, isLoading } = useQuery({
		...repositoryFileHistoryQueryOptions({
			repoId,
			branchName: branch,
			path: filePath,
			limit: 1,
			depth: "banner",
		}),
		enabled: !!repoId,
	});

	const commit = data?.entries[0];

	if (isLoading) {
		return <Skeleton className={bare ? "h-4 w-72" : "h-12 rounded-[18px]"} />;
	}
	if (!commit) return null;

	return (
		<div
			className={
				bare
					? "flex min-w-0 flex-1 items-center gap-3"
					: "flex min-h-12 items-center gap-3 rounded-[18px] border border-bjork-border-muted bg-bjork-surface px-5 py-2.5 shadow-(--bjork-shadow-soft)"
			}
		>
			<Avatar size="sm" className="shrink-0">
				<AvatarFallback className="text-[11px]">
					{getInitials(commit.authorName || "U")}
				</AvatarFallback>
			</Avatar>
			<span className="hidden shrink-0 text-sm font-medium text-bjork-text sm:inline">
				{commit.authorName}
			</span>
			<Link
				to="/$owner/$name/commit/$sha"
				params={{ owner, name, sha: commit.sha }}
				title={commit.message}
				className="min-w-0 flex-1 truncate text-sm text-bjork-text-muted hover:text-bjork-text"
			>
				{commit.message.split("\n")[0]}
			</Link>
			<Link
				to="/$owner/$name/commit/$sha"
				params={{ owner, name, sha: commit.sha }}
				className="hidden shrink-0 font-mono text-xs text-bjork-text-soft tabular-nums hover:text-bjork-text sm:inline"
			>
				{commit.sha.substring(0, 7)}
			</Link>
			<RelativeTime
				date={commit.createdAt}
				className="shrink-0 text-xs text-bjork-text-soft"
			/>
		</div>
	);
}

export function FileHistoryList({
	owner,
	name,
	repoId,
	branch,
	filePath,
}: {
	owner: string;
	name: string;
	repoId: number;
	branch: string;
	filePath: string;
}) {
	const [limit, setLimit] = useState(PAGE_SIZE);

	const { data, isLoading, isFetching } = useQuery({
		...repositoryFileHistoryQueryOptions({
			repoId,
			branchName: branch,
			path: filePath,
			limit,
		}),
		enabled: !!repoId,
	});

	if (isLoading) {
		return (
			<div className="space-y-2" aria-busy="true">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-14 rounded-[14px]" />
				))}
			</div>
		);
	}

	const entries = data?.entries ?? [];

	if (entries.length === 0) {
		return (
			<p className="py-10 text-center text-sm text-bjork-text-soft">
				No history found for this file.
			</p>
		);
	}

	return (
		<div className="space-y-4">
			<CommitList owner={owner} name={name} commits={entries} groupByDay />
			{data?.truncated ? (
				<div className="flex justify-center">
					<Button
						variant="outline"
						disabled={isFetching}
						onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
					>
						{isFetching ? "Loading…" : "Show older commits"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
