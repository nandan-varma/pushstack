import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryFileHistoryQueryOptions } from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

const PAGE_SIZE = 30;

/** GitHub-style "latest commit" strip shown above a file's content. */
export function FileCommitBanner({
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
	const { data, isLoading } = useQuery({
		...repositoryFileHistoryQueryOptions({
			repoId,
			branchName: branch,
			path: filePath,
			limit: 1,
		}),
		enabled: !!repoId,
	});

	const commit = data?.entries[0];

	if (isLoading) {
		return <Skeleton className="h-11 rounded-lg" />;
	}
	if (!commit) return null;

	return (
		<div className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5">
			<Avatar className="h-6 w-6 shrink-0">
				<AvatarFallback className="text-[10px]">
					{getInitials(commit.authorName || "U")}
				</AvatarFallback>
			</Avatar>
			<Link
				to="/repo/$owner/$name/commit/$sha"
				params={{ owner, name, sha: commit.sha }}
				title={commit.message}
				className="min-w-0 flex-1 truncate text-sm text-[var(--sea-ink)] hover:underline"
			>
				{commit.message.split("\n")[0]}
			</Link>
			<span className="shrink-0 text-xs text-[var(--sea-ink-soft)]">
				{commit.authorName}
				{" · "}
				{formatDistanceToNow(new Date(commit.createdAt), { addSuffix: true })}
			</span>
			<Link
				to="/repo/$owner/$name/commit/$sha"
				params={{ owner, name, sha: commit.sha }}
				className="shrink-0 rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
			>
				{commit.sha.substring(0, 7)}
			</Link>
		</div>
	);
}

/** Full, paginated list of commits that touched this exact file. */
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
			<div className="space-y-2">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-14" />
				))}
			</div>
		);
	}

	const entries = data?.entries ?? [];

	if (entries.length === 0) {
		return (
			<p className="py-6 text-center text-sm text-[var(--sea-ink-soft)]">
				No history found for this file.
			</p>
		);
	}

	return (
		<div className="space-y-3">
			<div className="overflow-hidden rounded-xl border border-[var(--line)]">
				{entries.map((commit, idx) => (
					<Link
						key={commit.sha}
						to="/repo/$owner/$name/commit/$sha"
						params={{ owner, name, sha: commit.sha }}
						className={`flex items-center gap-4 px-4 py-3 text-left no-underline transition hover:bg-[var(--surface-strong)] ${idx < entries.length - 1 ? "border-b border-[var(--line)]" : ""}`}
					>
						<Avatar className="h-7 w-7 shrink-0">
							<AvatarFallback className="text-[10px]">
								{getInitials(commit.authorName || "U")}
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1 space-y-0.5">
							<p
								title={commit.message}
								className="truncate text-sm font-medium leading-snug text-[var(--sea-ink)]"
							>
								{commit.message.split("\n")[0]}
							</p>
							<p className="text-xs leading-snug text-[var(--sea-ink-soft)]">
								{commit.authorName}
								{" · "}
								{formatDistanceToNow(new Date(commit.createdAt), {
									addSuffix: true,
								})}
							</p>
						</div>
						<code className="shrink-0 rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sea-ink-soft)]">
							{commit.sha.substring(0, 7)}
						</code>
					</Link>
				))}
			</div>
			{data?.truncated ? (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
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
