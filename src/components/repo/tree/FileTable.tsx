import { Link } from "@tanstack/react-router";
import { FileIcon, FolderIcon } from "./FileIcon";

interface FileEntry {
	type: "tree" | "blob";
	path: string;
	oid: string;
}

export function FileTable({
	files,
	owner,
	name,
	branch,
	activePath,
	isLoading,
}: {
	files: FileEntry[];
	owner: string;
	name: string;
	branch: string;
	activePath: string;
	isLoading?: boolean;
}) {
	if (isLoading) {
		return (
			<div className="overflow-hidden rounded-xl border border-[var(--line)]">
				{[1, 2, 3, 4, 5].map((i) => (
					<div
						key={i}
						className="h-11 animate-pulse border-b border-[var(--line)] last:border-0 bg-[var(--surface-raised)]"
					/>
				))}
			</div>
		);
	}

	if (!files || files.length === 0) {
		return (
			<div className="island-shell rounded-xl p-12 text-center">
				<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
					This repository is empty.
				</p>
				<Link
					to="/repo/$owner/$name/upload"
					params={{ owner, name }}
					search={{ branch }}
				>
					<button
						type="button"
						className="inline-flex items-center justify-center rounded-md bg-[var(--lagoon-deep)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--lagoon-deep)]/90"
					>
						Add file
					</button>
				</Link>
			</div>
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
							<td />
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
								<td className="py-2.5 pr-4 text-right">
									<code className="rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--sea-ink-soft)]">
										{file.oid.substring(0, 7)}
									</code>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
