import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { CornerLeftUp, GitFork } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FileIcon, FolderIcon } from "./FileIcon";

interface FileEntry {
	type: "tree" | "blob" | "commit";
	path: string;
	oid: string;
}

interface LastCommitInfo {
	sha: string;
	message: string;
	authorName: string;
	createdAt: string;
}

/**
 * Each row is one 44px target: the name link stretches over the whole row,
 * and the last-commit link sits above it so it stays separately clickable.
 */
const rowClassName =
	"relative grid min-h-11 grid-cols-[1rem_minmax(0,1fr)] items-center gap-3 px-5 py-2.5 transition-[background-color] duration-150 hover:bg-bjork-surface-hover";
/** Name, last-commit subject and age once the last-commit column is on. */
const withCommitColumns =
	"md:grid-cols-[1rem_minmax(0,16rem)_minmax(0,1fr)_7.5rem]";
const nameLinkClassName =
	"truncate text-sm text-bjork-text after:absolute after:inset-0 hover:text-bjork-accent focus-visible:outline-none focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset";

export function FileTable({
	files,
	owner,
	name,
	branch,
	activePath,
	isLoading,
	showLastCommit = false,
	lastCommits,
	lastCommitsLoading,
	header,
	className,
}: {
	files: FileEntry[];
	owner: string;
	name: string;
	branch: string;
	activePath: string;
	isLoading?: boolean;
	showLastCommit?: boolean;
	lastCommits?: Record<string, LastCommitInfo>;
	lastCommitsLoading?: boolean;
	/** Content of the panel's header row, usually the latest commit. */
	header?: ReactNode;
	className?: string;
}) {
	if (!isLoading && files.length === 0) {
		return (
			<EmptyState
				message="This repository is empty."
				action={
					<Link
						to="/$owner/$name/upload"
						params={{ owner, name }}
						search={{ branch }}
					>
						<Button size="sm">Add file</Button>
					</Link>
				}
			/>
		);
	}

	return (
		<Panel aria-label="Files" className={className}>
			{header && <PanelHeader>{header}</PanelHeader>}
			{isLoading ? (
				<ul aria-busy="true" className="divide-y divide-bjork-border-muted">
					{["45%", "60%", "38%", "70%", "50%", "42%"].map((width) => (
						<li key={width} className={rowClassName}>
							<Skeleton className="size-4" />
							<Skeleton className="h-3.5" style={{ width }} />
						</li>
					))}
				</ul>
			) : (
				<ul className="divide-y divide-bjork-border-muted">
					{activePath && (
						<li className={rowClassName}>
							<CornerLeftUp
								aria-hidden="true"
								className="size-4 text-bjork-text-soft"
							/>
							<Link
								to="/$owner/$name/tree/$branch/$"
								params={{
									owner,
									name,
									branch,
									_splat: activePath.includes("/")
										? activePath.slice(0, activePath.lastIndexOf("/"))
										: "",
								}}
								aria-label="Parent directory"
								className={nameLinkClassName}
							>
								..
							</Link>
						</li>
					)}
					{files.map((file) => {
						const displayName = activePath
							? file.path.slice(activePath.length + 1)
							: file.path;
						const lastCommit = lastCommits?.[file.path];
						return (
							<li
								key={`${file.type}:${file.path}`}
								className={cn(
									rowClassName,
									showLastCommit && withCommitColumns,
								)}
							>
								{file.type === "commit" ? (
									<GitFork
										className="size-4 text-bjork-accent"
										aria-hidden="true"
									/>
								) : file.type === "tree" ? (
									<FolderIcon />
								) : (
									<FileIcon />
								)}
								<Link
									to={
										file.type === "tree"
											? "/$owner/$name/tree/$branch/$"
											: "/$owner/$name/blob/$branch/$"
									}
									params={{ owner, name, branch, _splat: file.path }}
									title={displayName}
									className={nameLinkClassName}
								>
									{displayName}
									{file.type === "commit" && (
										<span className="ml-2 font-mono text-xs text-bjork-text-soft">
											@ {file.oid.slice(0, 7)}
										</span>
									)}
								</Link>
								{showLastCommit && (
									<>
										<div className="relative z-10 hidden min-w-0 md:block">
											{lastCommitsLoading ? (
												<Skeleton className="h-3 w-48" />
											) : (
												lastCommit && (
													<Link
														to="/$owner/$name/commit/$sha"
														params={{ owner, name, sha: lastCommit.sha }}
														title={lastCommit.message}
														className="block truncate text-[13px] text-bjork-text-soft hover:text-bjork-text"
													>
														{lastCommit.message.split("\n")[0]}
													</Link>
												)
											)}
										</div>
										<div className="hidden text-right text-xs text-bjork-text-soft tabular-nums md:block">
											{lastCommitsLoading ? (
												<Skeleton className="ml-auto h-3 w-16" />
											) : (
												lastCommit && (
													<time dateTime={lastCommit.createdAt}>
														{formatDistanceToNow(
															new Date(lastCommit.createdAt),
															{
																addSuffix: true,
															},
														)}
													</time>
												)
											)}
										</div>
									</>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</Panel>
	);
}
