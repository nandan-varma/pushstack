import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, GitFork } from "lucide-react";
import { useEffect, useState } from "react";
import { RefSelect } from "@/components/repo/RefSelect";
import { FileIcon, FolderIcon } from "@/components/repo/tree/FileIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { repositoryTreeEntriesQueryOptions } from "@/lib/query-options";
import { cn } from "@/lib/utils";

interface TreeContext {
	owner: string;
	name: string;
	repoId: number;
	gitRef: string;
	/** The file or directory the page shows; its row is highlighted. */
	activePath: string;
	/** Directories the person opened (plus every ancestor of `activePath`). */
	open: Set<string>;
	toggle: (path: string) => void;
}

const rowClassName =
	"flex h-7 w-full items-center gap-1.5 rounded-[8px] pr-2 text-[13px] text-bjork-text-medium transition-[background-color,color] duration-100 hover:bg-bjork-surface-hover hover:text-bjork-text";
const activeRowClassName =
	"bg-bjork-surface-active font-medium text-bjork-text hover:bg-bjork-surface-active";

function sortEntries<T extends { type: string; path: string }>(entries: T[]) {
	return [...entries].sort((a, b) =>
		a.type === b.type
			? a.path.localeCompare(b.path)
			: a.type === "tree"
				? -1
				: b.type === "tree"
					? 1
					: a.path.localeCompare(b.path),
	);
}

function TreeLevel({
	path,
	depth,
	ctx,
}: {
	path: string;
	depth: number;
	ctx: TreeContext;
}) {
	const { data: entries, isLoading } = useQuery(
		repositoryTreeEntriesQueryOptions({
			repoId: ctx.repoId,
			branchName: ctx.gitRef,
			path,
		}),
	);
	const indent = { paddingLeft: `${8 + depth * 14}px` };

	if (isLoading) {
		return (
			<div className="space-y-1.5 py-1" style={indent}>
				<Skeleton className="h-3.5 w-3/4" />
				<Skeleton className="h-3.5 w-1/2" />
			</div>
		);
	}

	return (
		<ul>
			{sortEntries(entries ?? []).map((entry) => {
				const label = path ? entry.path.slice(path.length + 1) : entry.path;
				const active = entry.path === ctx.activePath;
				if (entry.type === "tree") {
					const isOpen = ctx.open.has(entry.path);
					return (
						<li key={entry.path}>
							<div
								className={cn(rowClassName, active && activeRowClassName)}
								style={indent}
							>
								<button
									type="button"
									aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
									aria-expanded={isOpen}
									onClick={() => ctx.toggle(entry.path)}
									className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded-[6px] text-bjork-text-soft hover:text-bjork-text"
								>
									<ChevronRight
										aria-hidden="true"
										className={cn(
											"size-3.5 transition-transform duration-150",
											isOpen && "rotate-90",
										)}
									/>
								</button>
								<Link
									to="/$owner/$name/tree/$branch/$"
									params={{
										owner: ctx.owner,
										name: ctx.name,
										branch: ctx.gitRef,
										_splat: entry.path,
									}}
									aria-current={active ? "page" : undefined}
									className="flex min-w-0 flex-1 items-center gap-1.5"
								>
									<FolderIcon />
									<span className="truncate">{label}</span>
								</Link>
							</div>
							{isOpen && (
								<TreeLevel path={entry.path} depth={depth + 1} ctx={ctx} />
							)}
						</li>
					);
				}
				return (
					<li key={entry.path}>
						<Link
							to="/$owner/$name/blob/$branch/$"
							params={{
								owner: ctx.owner,
								name: ctx.name,
								branch: ctx.gitRef,
								_splat: entry.path,
							}}
							aria-current={active ? "page" : undefined}
							className={cn(rowClassName, active && activeRowClassName)}
							style={{ paddingLeft: `${8 + depth * 14 + 20}px` }}
						>
							{entry.type === "commit" ? (
								<GitFork
									aria-hidden="true"
									className="size-4 text-bjork-accent"
								/>
							) : (
								<FileIcon />
							)}
							<span className="truncate">{label}</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

function ancestorsOf(path: string) {
	const parts = path.split("/").filter(Boolean);
	return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * The repository's files as a tree beside whatever the page shows, so moving
 * between files never round-trips through a directory listing. Ancestors of
 * the open path expand themselves; the branch picker lives at the top.
 */
export function FileTreePane({
	owner,
	name,
	repoId,
	gitRef,
	activePath,
	kind,
}: {
	owner: string;
	name: string;
	repoId: number;
	gitRef: string;
	activePath: string;
	kind: "tree" | "blob";
}) {
	const navigate = useNavigate();
	const [open, setOpen] = useState<Set<string>>(
		() => new Set(ancestorsOf(activePath)),
	);
	// Navigating elsewhere opens the new path's ancestors without closing
	// what the person already opened.
	useEffect(() => {
		setOpen((previous) => {
			const next = new Set(previous);
			for (const dir of ancestorsOf(activePath)) next.add(dir);
			return next;
		});
	}, [activePath]);

	const ctx: TreeContext = {
		owner,
		name,
		repoId,
		gitRef,
		activePath,
		open,
		toggle: (path) =>
			setOpen((previous) => {
				const next = new Set(previous);
				if (!next.delete(path)) next.add(path);
				return next;
			}),
	};

	const isSha = /^[0-9a-f]{40}$/i.test(gitRef);

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-bjork-border-muted p-2">
				{isSha ? (
					<p className="px-2 py-1.5 font-mono text-xs text-bjork-text-medium">
						@ {gitRef.slice(0, 7)}
					</p>
				) : (
					<RefSelect
						repoId={repoId}
						value={gitRef}
						onChange={(ref) =>
							navigate(
								kind === "tree"
									? {
											to: "/$owner/$name/tree/$branch/$",
											params: { owner, name, branch: ref, _splat: activePath },
										}
									: {
											to: "/$owner/$name/blob/$branch/$",
											params: { owner, name, branch: ref, _splat: activePath },
										},
							)
						}
					/>
				)}
			</div>
			<nav aria-label="Files" className="min-h-0 flex-1 overflow-y-auto p-1.5">
				<Link
					to="/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch: gitRef, _splat: "" }}
					className={cn(
						rowClassName,
						"pl-2 font-medium",
						activePath === "" && activeRowClassName,
					)}
				>
					{name}
				</Link>
				<TreeLevel path="" depth={0} ctx={ctx} />
			</nav>
		</div>
	);
}
