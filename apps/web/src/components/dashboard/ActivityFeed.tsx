import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import {
	CircleDot,
	FolderPlus,
	GitCommitHorizontal,
	GitPullRequest,
	MessageSquare,
	Star,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ActivityRow, describeActivity } from "@/lib/activity";
import type { ActivityType } from "@/lib/activity-types";

const icons: Record<ActivityType, typeof Star> = {
	create_repo: FolderPlus,
	star: Star,
	commit: GitCommitHorizontal,
	issue: CircleDot,
	pr: GitPullRequest,
	comment: MessageSquare,
};

type FeedItem = { row: ActivityRow; repeats: number };

/** Back-to-back identical events (starring twice, say) read as one row. */
function collapseRepeats(rows: ActivityRow[]): FeedItem[] {
	const items: FeedItem[] = [];
	for (const row of rows) {
		const last = items.at(-1);
		if (
			last &&
			last.row.type === row.type &&
			last.row.repository?.name === row.repository?.name &&
			last.row.repository?.owner.username === row.repository?.owner.username &&
			describeActivity(last.row).text === describeActivity(row).text
		) {
			last.repeats += 1;
		} else {
			items.push({ row, repeats: 1 });
		}
	}
	return items;
}

/**
 * A person's recent actions as one dense panel: what, where, and how long
 * ago, each row linking to the thing it touched.
 */
export function ActivityFeed({
	activities,
	isLoading,
	isError,
	onRetry,
	title = "Recent activity",
	action,
}: {
	activities?: ActivityRow[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry?: () => void;
	title?: string;
	action?: ReactNode;
}) {
	return (
		<Panel>
			<PanelHeader title={title} actions={action} />
			{isLoading ? (
				<ul aria-busy="true" className="divide-y divide-bjork-border-muted">
					{[1, 2, 3, 4].map((i) => (
						<li key={i} className="flex h-11 items-center gap-3 px-4">
							<Skeleton className="size-4" />
							<Skeleton className="h-3.5 flex-1" />
						</li>
					))}
				</ul>
			) : isError ? (
				<EmptyState
					bare
					variant="error"
					message="Couldn't load recent activity."
					action={
						onRetry && (
							<Button variant="outline" onClick={onRetry}>
								Try again
							</Button>
						)
					}
				/>
			) : !activities?.length ? (
				<EmptyState bare message="No activity yet." />
			) : (
				<ul className="divide-y divide-bjork-border-muted">
					{collapseRepeats(activities).map(({ row, repeats }) => {
						const { text, link } = describeActivity(row);
						const Icon = icons[row.type];
						const createdAt = new Date(row.createdAt);
						const repoLabel =
							row.repository &&
							`${row.repository.owner.username}/${row.repository.name}`;
						const body = (
							<>
								<Icon
									aria-hidden="true"
									className="size-4 shrink-0 text-bjork-text-soft"
								/>
								<span className="min-w-0 flex-1 truncate text-sm text-bjork-text">
									{text}
									{repeats > 1 && (
										<span className="ml-1.5 font-mono text-xs text-bjork-text-soft">
											×{repeats}
										</span>
									)}
									{repoLabel && (
										<span className="ml-1.5 text-bjork-text-soft">
											{repoLabel}
										</span>
									)}
								</span>
								<time
									dateTime={createdAt.toISOString()}
									title={createdAt.toLocaleString()}
									className="shrink-0 text-xs text-bjork-text-soft tabular-nums"
								>
									{formatDistanceToNowStrict(createdAt)}
								</time>
							</>
						);
						const rowClassName = "flex min-h-11 items-center gap-3 px-4 py-2";
						return (
							<li key={row.id}>
								{link ? (
									<Link
										to={link.to}
										params={link.params}
										className={`${rowClassName} transition-[background-color] duration-150 hover:bg-bjork-surface-hover`}
									>
										{body}
									</Link>
								) : (
									<div className={rowClassName}>{body}</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</Panel>
	);
}
