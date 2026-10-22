import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { GitFork } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
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
}) {
	if (isLoading) {
		const rowWidths = ["45%", "60%", "38%", "70%", "50%", "42%", "65%", "35%"];
		return (
			<div className="island-shell overflow-hidden rounded-[18px]">
				<table className="w-full table-fixed">
					<tbody>
						{rowWidths.map((width, i) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
								key={i}
								className="border-b border-border last:border-0"
							>
								<td className="w-10 py-3 pl-4 pr-2 align-middle">
									<div className="h-4 w-4 animate-pulse rounded bg-muted" />
								</td>
								<td className="py-3 pr-4 align-middle">
									<div
										className="h-3.5 animate-pulse rounded bg-muted"
										style={{ width }}
									/>
								</td>
								{showLastCommit && (
									<td className="hidden py-3 pr-4 align-middle md:table-cell">
										<div className="ml-auto flex items-center justify-end gap-2">
											<div className="h-3 w-40 animate-pulse rounded bg-muted" />
											<div className="h-3 w-14 shrink-0 animate-pulse rounded bg-muted" />
										</div>
									</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	if (files.length === 0) {
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
		<div className="island-shell overflow-hidden rounded-[18px]">
			<table className="w-full table-fixed">
				<tbody>
					{activePath && (
						<tr className="border-b border-border transition-colors hover:bg-accent/60">
							<td className="w-10 py-3 pl-4" />
							<td className="py-3 pr-4">
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
									className="text-sm font-medium text-foreground hover:underline"
								>
									..
								</Link>
							</td>
							{showLastCommit && <td className="hidden md:table-cell" />}
						</tr>
					)}
					{files.map((file) => {
						const displayName = activePath
							? file.path.slice(activePath.length + 1)
							: file.path;
						return (
							<tr
								key={`${file.type}:${file.path}`}
								className="border-b border-border transition-colors hover:bg-accent/60 last:border-0"
							>
								<td className="w-10 py-3 pl-4 pr-2 align-middle">
									{file.type === "commit" ? (
										<GitFork
											className="size-4 text-primary"
											aria-hidden="true"
										/>
									) : file.type === "tree" ? (
										<FolderIcon />
									) : (
										<FileIcon />
									)}
								</td>
								<td className="py-3 pr-4 align-middle">
									{file.type === "tree" ? (
										<Link
											to="/$owner/$name/tree/$branch/$"
											params={{
												owner,
												name,
												branch,
												_splat: file.path,
											}}
											title={displayName}
											className="block max-w-full truncate text-sm font-medium text-foreground hover:underline"
										>
											{displayName}
										</Link>
									) : (
										<Link
											to="/$owner/$name/blob/$branch/$"
											params={{
												owner,
												name,
												branch,
												_splat: file.path,
											}}
											title={displayName}
											className="block max-w-full truncate text-sm font-medium text-foreground hover:underline"
										>
											{displayName}
											{file.type === "commit" && (
												<span className="ml-2 font-mono text-xs text-muted-foreground">
													@ {file.oid.slice(0, 7)}{" "}
													<span className="font-sans">(submodule)</span>
												</span>
											)}
										</Link>
									)}
								</td>
								{showLastCommit && (
									<td className="hidden py-3 pr-4 text-right align-middle md:table-cell">
										{lastCommitsLoading ? (
											<div className="ml-auto h-3 w-32 animate-pulse rounded bg-muted" />
										) : (
											(() => {
												const lastCommit = lastCommits?.[file.path];
												if (!lastCommit) return null;
												return (
													<div className="flex items-center justify-end gap-2">
														<Link
															to="/$owner/$name/commit/$sha"
															params={{ owner, name, sha: lastCommit.sha }}
															title={lastCommit.message}
															className="max-w-[220px] truncate text-xs text-muted-foreground hover:text-primary hover:underline"
														>
															{lastCommit.message.split("\n")[0]}
														</Link>
														<span className="shrink-0 text-xs text-muted-foreground">
															{formatDistanceToNow(
																new Date(lastCommit.createdAt),
																{
																	addSuffix: true,
																},
															)}
														</span>
													</div>
												);
											})()
										)}
									</td>
								)}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
