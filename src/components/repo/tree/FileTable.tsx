import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { FileIcon, FolderIcon } from "./FileIcon";

interface FileEntry {
	type: "tree" | "blob";
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
	/** Repo setting (Settings > Performance), off by default — see FileTable's row rendering below. */
	showLastCommit?: boolean;
	lastCommits?: Record<string, LastCommitInfo>;
	lastCommitsLoading?: boolean;
}) {
	if (isLoading) {
		// Row count/width pattern mimics a typical directory listing (a few
		// folders first, then files of varying name length) so the skeleton
		// reads as "file list" rather than a generic block, and settles into
		// real rows without a jarring size change once data arrives.
		const rowWidths = ["45%", "60%", "38%", "70%", "50%", "42%", "65%", "35%"];
		return (
			<div className="overflow-hidden rounded-xl border border-[var(--line)]">
				<table className="w-full">
					<tbody>
						{rowWidths.map((width, i) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
								key={i}
								className="border-b border-[var(--line)] last:border-0"
							>
								<td className="w-8 py-2.5 pl-4 pr-2 align-middle">
									<div className="h-4 w-4 animate-pulse rounded bg-[var(--surface-raised)]" />
								</td>
								<td className="py-2.5 pr-4 align-middle">
									<div
										className="h-3.5 animate-pulse rounded bg-[var(--surface-raised)]"
										style={{ width }}
									/>
								</td>
								{showLastCommit && (
									<td className="hidden py-2.5 pr-4 align-middle md:table-cell">
										<div className="ml-auto flex items-center justify-end gap-2">
											<div className="h-3 w-40 animate-pulse rounded bg-[var(--surface-raised)]" />
											<div className="h-3 w-14 shrink-0 animate-pulse rounded bg-[var(--surface-raised)]" />
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

	if (!files || files.length === 0) {
		return (
			<EmptyState
				message="This repository is empty."
				action={
					<Link
						to="/repo/$owner/$name/upload"
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
		<div className="overflow-hidden rounded-xl border border-[var(--line)]">
			<table className="w-full">
				<tbody>
					{activePath && (
						<tr className="border-b border-[var(--line)] transition hover:bg-[var(--surface-strong)]">
							<td className="w-8 py-2.5 pl-4" />
							<td className="py-2.5 pr-4">
								<Link
									to="/repo/$owner/$name/tree/$branch/$"
									params={{
										owner,
										name,
										branch,
										_splat: activePath.includes("/")
											? activePath.slice(0, activePath.lastIndexOf("/"))
											: "",
									}}
									className="text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
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
								className="border-b border-[var(--line)] transition hover:bg-[var(--surface-strong)] last:border-0"
							>
								<td className="w-8 py-2.5 pl-4 pr-2 align-middle">
									{file.type === "tree" ? <FolderIcon /> : <FileIcon />}
								</td>
								<td className="py-2.5 pr-4 align-middle">
									{file.type === "tree" ? (
										<Link
											to="/repo/$owner/$name/tree/$branch/$"
											params={{
												owner,
												name,
												branch,
												_splat: file.path,
											}}
											title={displayName}
											className="max-w-xs truncate text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
										>
											{displayName}
										</Link>
									) : (
										<Link
											to="/repo/$owner/$name/blob/$branch/$"
											params={{
												owner,
												name,
												branch,
												_splat: file.path,
											}}
											title={displayName}
											className="max-w-xs truncate text-sm font-medium text-[var(--lagoon-deep)] hover:underline"
										>
											{displayName}
										</Link>
									)}
								</td>
								{showLastCommit && (
									<td className="hidden py-2.5 pr-4 text-right align-middle md:table-cell">
										{lastCommitsLoading ? (
											<div className="ml-auto h-3 w-32 animate-pulse rounded bg-[var(--surface-raised)]" />
										) : (
											(() => {
												const lastCommit = lastCommits?.[file.path];
												if (!lastCommit) return null;
												return (
													<div className="flex items-center justify-end gap-2">
														<Link
															to="/repo/$owner/$name/commit/$sha"
															params={{ owner, name, sha: lastCommit.sha }}
															title={lastCommit.message}
															className="max-w-[220px] truncate text-xs text-[var(--sea-ink-soft)] hover:text-[var(--lagoon-deep)] hover:underline"
														>
															{lastCommit.message.split("\n")[0]}
														</Link>
														<span className="shrink-0 text-xs text-[var(--sea-ink-soft)]">
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
