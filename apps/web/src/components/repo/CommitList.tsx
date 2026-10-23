import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { GitCommitHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { RelativeTime } from "@/components/RelativeTime";
import { type CheckState, CheckStateIcon } from "@/components/repo/Checks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { commitRollupsQueryOptions } from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

export type CommitListItem = {
	sha: string;
	message: string;
	authorName: string;
	createdAt: string;
};

/**
 * One commit: who, the subject, when, and the short sha. The subject link
 * stretches over the row so the whole row is one target.
 */
export function CommitRow({
	owner,
	name,
	commit,
	checks,
}: {
	owner: string;
	name: string;
	commit: CommitListItem;
	/** What CI reported for this commit, if anything. */
	checks?: CheckState | undefined;
}) {
	return (
		<li className="relative flex min-h-14 items-center gap-3 px-5 py-3 transition-[background-color] duration-150 hover:bg-bjork-surface-hover">
			<Avatar size="sm" className="shrink-0">
				<AvatarFallback className="text-[11px]">
					{getInitials(commit.authorName || "U")}
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1">
				<Link
					to="/$owner/$name/commit/$sha"
					params={{ owner, name, sha: commit.sha }}
					title={commit.message}
					className="block truncate text-sm font-medium text-bjork-text after:absolute after:inset-0 hover:text-bjork-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
				>
					{commit.message.split("\n")[0]}
				</Link>
				<p className="mt-0.5 truncate text-xs text-bjork-text-soft">
					<span className="text-bjork-text-medium">{commit.authorName}</span>{" "}
					committed <RelativeTime date={commit.createdAt} />
				</p>
			</div>
			{checks && (
				<span className="relative shrink-0">
					<CheckStateIcon state={checks} />
				</span>
			)}
			<code className="shrink-0 rounded-[8px] border border-bjork-border bg-bjork-field-inset px-2 py-1 font-mono text-[11px] text-bjork-text-medium tabular-nums">
				{commit.sha.substring(0, 7)}
			</code>
		</li>
	);
}

function dayOf(commit: CommitListItem) {
	return format(new Date(commit.createdAt), "yyyy-MM-dd");
}

/**
 * Commits in a panel. `groupByDay` splits them under "Commits on …" headings
 * the way a history page reads; otherwise `header` (if any) titles the panel.
 */
export function CommitList({
	owner,
	name,
	commits,
	groupByDay = false,
	header,
	repoId,
}: {
	owner: string;
	name: string;
	commits: CommitListItem[];
	groupByDay?: boolean;
	header?: ReactNode;
	/** With it, each commit shows its rolled-up CI state. */
	repoId?: number | undefined;
}) {
	// Rollups are keyed by full sha; a page of history is at most 100 commits.
	const { data: rollups } = useQuery({
		...commitRollupsQueryOptions(
			repoId ?? 0,
			commits
				.map((commit) => commit.sha)
				.filter((sha) => /^[0-9a-f]{40}$/i.test(sha))
				.slice(0, 100),
		),
		enabled: repoId !== undefined && commits.length > 0,
	});
	if (!groupByDay) {
		return (
			<Panel>
				{header && <PanelHeader>{header}</PanelHeader>}
				<ul className="divide-y divide-bjork-border-muted">
					{commits.map((commit) => (
						<CommitRow
							key={commit.sha}
							owner={owner}
							name={name}
							commit={commit}
							checks={rollups?.[commit.sha]}
						/>
					))}
				</ul>
			</Panel>
		);
	}

	const days: { day: string; commits: CommitListItem[] }[] = [];
	for (const commit of commits) {
		const day = dayOf(commit);
		const last = days.at(-1);
		if (last?.day === day) last.commits.push(commit);
		else days.push({ day, commits: [commit] });
	}

	return (
		<ol className="space-y-6">
			{days.map(({ day, commits: dayCommits }) => (
				<li key={day}>
					<h2 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-bjork-text-muted">
						<GitCommitHorizontal
							aria-hidden="true"
							className="size-4 text-bjork-text-soft"
						/>
						Commits on{" "}
						{format(new Date(dayCommits[0].createdAt), "MMM d, yyyy")}
					</h2>
					<Panel>
						<ul className="divide-y divide-bjork-border-muted">
							{dayCommits.map((commit) => (
								<CommitRow
									key={commit.sha}
									owner={owner}
									name={name}
									commit={commit}
									checks={rollups?.[commit.sha]}
								/>
							))}
						</ul>
					</Panel>
				</li>
			))}
		</ol>
	);
}
