import { Link } from "@tanstack/react-router";
import { GitBranch, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { RelativeTime } from "@/components/RelativeTime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface RepositorySummary {
	id: number;
	name: string;
	description: string | null;
	visibility: string;
	defaultBranch: string;
	updatedAt: string | Date;
	owner: { username: string };
}

/**
 * One repository as a dense row: name (and owner when it isn't obvious), a
 * lock when private, the description, then branch and age on wide rows.
 */
export function RepositoryRow({
	repo,
	showOwner = true,
	compact = false,
}: {
	repo: RepositorySummary;
	showOwner?: boolean;
	/** Name and age only, for narrow side columns. */
	compact?: boolean;
}) {
	const owner = repo.owner.username;
	const updatedAt = new Date(repo.updatedAt);
	return (
		<li>
			<Link
				to="/$owner/$name/tree/$branch/$"
				params={{
					owner,
					name: repo.name,
					branch: repo.defaultBranch,
					_splat: "",
				}}
				className={cn(
					"group grid min-h-12 items-center gap-x-4 px-4 py-2.5 transition-[background-color] duration-150 hover:bg-bjork-surface-hover",
					compact
						? "grid-cols-[minmax(0,1fr)_auto]"
						: "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]",
				)}
			>
				<span className="flex min-w-0 items-center gap-1.5 text-sm">
					{showOwner && (
						<span className="truncate text-bjork-text-soft">{owner} /</span>
					)}
					<span className="truncate font-semibold text-bjork-text group-hover:text-bjork-accent">
						{repo.name}
					</span>
					{repo.visibility !== "public" && (
						<Lock
							aria-label="Private"
							className="size-3.5 shrink-0 text-bjork-text-soft"
						/>
					)}
				</span>
				{!compact && (
					<span className="col-span-2 row-start-2 truncate text-[13px] text-bjork-text-muted md:col-span-1 md:row-start-auto">
						{repo.description || (
							<span className="text-bjork-text-soft">No description</span>
						)}
					</span>
				)}
				<span className="row-start-1 flex items-center justify-end gap-3 text-xs text-bjork-text-soft tabular-nums md:row-start-auto">
					{!compact && (
						<span className="hidden items-center gap-1 font-mono lg:inline-flex">
							<GitBranch aria-hidden="true" className="size-3.5" />
							{repo.defaultBranch}
						</span>
					)}
					<RelativeTime date={updatedAt} strict />
				</span>
			</Link>
		</li>
	);
}

/** Repositories in a panel, with loading, error and empty states in place. */
export function RepositoryList({
	repos,
	isLoading,
	isError,
	onRetry,
	title,
	action,
	showOwner = true,
	compact = false,
	empty,
}: {
	repos?: RepositorySummary[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry?: () => void;
	title?: ReactNode;
	action?: ReactNode;
	showOwner?: boolean;
	compact?: boolean;
	/** What an empty list shows; defaults to a plain sentence. */
	empty?: ReactNode;
}) {
	return (
		<Panel>
			{(title || action) && <PanelHeader title={title} actions={action} />}
			{isLoading ? (
				<ul aria-busy="true" className="divide-y divide-bjork-border-muted">
					{[1, 2, 3].map((i) => (
						<li key={i} className="flex h-12 items-center gap-4 px-4">
							<Skeleton className="h-3.5 w-40" />
							<Skeleton className="h-3 flex-1" />
						</li>
					))}
				</ul>
			) : isError ? (
				<EmptyState
					bare
					variant="error"
					message="Couldn't load repositories."
					action={
						onRetry && (
							<Button variant="outline" onClick={onRetry}>
								Try again
							</Button>
						)
					}
				/>
			) : !repos?.length ? (
				(empty ?? <EmptyState bare message="No repositories yet." />)
			) : (
				<ul className="divide-y divide-bjork-border-muted">
					{repos.map((repo) => (
						<RepositoryRow
							key={repo.id}
							repo={repo}
							showOwner={showOwner}
							compact={compact}
						/>
					))}
				</ul>
			)}
		</Panel>
	);
}
