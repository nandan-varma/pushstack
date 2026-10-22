import type { DiffFile } from "git-fs-s3/ops";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";
import { BinaryPreview } from "@/components/BinaryPreview";
import { EmptyState } from "@/components/EmptyState";
import { Toolbar } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	anchorsForLine,
	type DiffAnchor,
	type ParsedDiffLine,
	parsePatch,
	primaryAnchor,
} from "@/lib/diff";
import { rawFileUrl } from "@/lib/file-view";
import {
	detectLanguage,
	formatFileSize,
	getPreviewKind,
	isLargeContent,
} from "@/lib/language-detection";
import { requestHighlightTokens } from "@/lib/syntax-highlight-client";
import { cn } from "@/lib/utils";
import { SubmoduleDiff } from "./SubmoduleDiff";

type FileDiff = DiffFile;

export interface DiffSides {
	owner: string;
	name: string;
	/** Absent when there's no "before" (a root commit). */
	oldRef?: string;
	newRef: string;
}

function BinaryDiffSide({
	label,
	src,
	size,
	path,
}: {
	label: string;
	/** Null when the file doesn't exist on this side. */
	src: string | null;
	size: number | undefined;
	path: string;
}) {
	const previewKind = getPreviewKind(path);

	return (
		<div className="min-w-0">
			<p className="mb-2 text-xs font-medium text-muted-foreground">
				{label}
				{size !== undefined ? ` · ${formatFileSize(size)}` : ""}
			</p>
			{src && previewKind ? (
				<BinaryPreview src={src} previewKind={previewKind} fileName={path} />
			) : (
				<div className="rounded-md border border-dashed border-border bg-muted p-6 text-center text-xs text-muted-foreground">
					No file
				</div>
			)}
		</div>
	);
}

function sizeChange(fileDiff: FileDiff): string {
	const size = (bytes: number | undefined) =>
		bytes === undefined ? "—" : formatFileSize(bytes);
	return `${size(fileDiff.oldSize)} → ${size(fileDiff.newSize)}`;
}

function UnpatchedDiff({
	fileDiff,
	sides,
}: {
	fileDiff: FileDiff;
	sides?: DiffSides;
}) {
	const previewKind = getPreviewKind(fileDiff.path);
	if (fileDiff.kind === "too-large" || !previewKind || !sides) {
		return (
			<p className="text-xs text-muted-foreground">
				{fileDiff.kind === "too-large"
					? "Large file changed — diff not shown"
					: "Binary file changed"}{" "}
				({sizeChange(fileDiff)})
			</p>
		);
	}

	const sideSrc = (ref: string | undefined, path: string, exists: boolean) =>
		ref && exists
			? rawFileUrl({ owner: sides.owner, name: sides.name, ref, path })
			: null;

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<BinaryDiffSide
				label="Before"
				src={sideSrc(
					sides.oldRef,
					fileDiff.path,
					fileDiff.oldSize !== undefined,
				)}
				size={fileDiff.oldSize}
				path={fileDiff.path}
			/>
			<BinaryDiffSide
				label="After"
				src={sideSrc(
					sides.newRef,
					fileDiff.path,
					fileDiff.newSize !== undefined,
				)}
				size={fileDiff.newSize}
				path={fileDiff.path}
			/>
		</div>
	);
}

interface HunkSegment {
	start: number;
	end: number;
}

interface ParsedFileDiff extends FileDiff {
	language: string;
	lines: ParsedDiffLine[];
	hunkSegments: HunkSegment[];
	additions: number;
	deletions: number;
	hunks: number;
	visibleLineCount: number;
}

// Hunks aren't contiguous in the real file, so each hunk is tokenized on its
// own request — joining them into one blob would let tokenizer state (e.g. an
// open string/comment) leak across an unrelated hunk boundary.
function getHunkSegments(lines: ParsedDiffLine[]): HunkSegment[] {
	const segments: HunkSegment[] = [];
	let segmentStart: number | null = null;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].kind === "hunk") {
			if (segmentStart !== null) {
				segments.push({ start: segmentStart, end: i });
				segmentStart = null;
			}
			continue;
		}
		if (segmentStart === null) segmentStart = i;
	}

	if (segmentStart !== null)
		segments.push({ start: segmentStart, end: lines.length });
	return segments;
}

const NO_TOKENS: ThemedToken[] = [];

function tokenStyle(token: ThemedToken): CSSProperties {
	return (token.htmlStyle ?? {}) as CSSProperties;
}

function renderLineCode(
	line: ParsedDiffLine,
	lineTokens: ThemedToken[] | undefined,
): ReactNode {
	if (!line.highlightText) {
		return line.code || " ";
	}

	if (!lineTokens || lineTokens.length === 0) {
		return line.code || " ";
	}

	let offset = 0;
	return lineTokens.map((token) => {
		const start = offset;
		offset += token.content.length;

		return (
			<span
				key={`${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${start}`}
				style={tokenStyle(token)}
			>
				{token.content || " "}
			</span>
		);
	});
}

export function FileDiffViewer({
	files,
	sides,
	isLoading,
	emptyMessage,
	summaryExtra,
	toolbarActions,
	renderLineActions,
	renderThreads,
}: {
	files?: FileDiff[];
	/** Needed to preview binary media; without it they're summarized. */
	sides?: DiffSides;
	isLoading?: boolean;
	emptyMessage?: string;
	summaryExtra?: ReactNode;
	/** Right side of the toolbar, e.g. a pull request's review button. */
	toolbarActions?: ReactNode;
	renderLineActions?: (anchor: DiffAnchor) => ReactNode;
	renderThreads?: (anchors: DiffAnchor[]) => ReactNode;
}) {
	const parsedFiles = useMemo<ParsedFileDiff[]>(
		() =>
			(files ?? []).map((fileDiff) => {
				const lines = parsePatch(fileDiff.patch);
				const visibleLines = lines.filter((line) => line.kind !== "hunk");
				const additions = lines.filter((line) => line.kind === "add").length;
				const deletions = lines.filter((line) => line.kind === "remove").length;
				const hunks = lines.filter((line) => line.kind === "hunk").length;

				return {
					...fileDiff,
					language: detectLanguage(fileDiff.path),
					lines,
					hunkSegments: getHunkSegments(lines),
					additions,
					deletions,
					hunks,
					visibleLineCount: visibleLines.length,
				};
			}),
		[files],
	);

	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(
		{},
	);

	const [lineTokensByPath, setLineTokensByPath] = useState<
		Record<string, ThemedToken[][]>
	>({});

	useEffect(() => {
		let cancelled = false;

		if (parsedFiles.length === 0) {
			setLineTokensByPath({});
			return;
		}

		const run = async () => {
			const highlights = await Promise.all(
				parsedFiles.map(async (fileDiff) => {
					if (
						fileDiff.kind === "submodule" ||
						fileDiff.hunkSegments.length === 0
					) {
						return [fileDiff.path, null] as const;
					}

					const tokenLines: ThemedToken[][] = new Array(
						fileDiff.lines.length,
					).fill(NO_TOKENS);

					await Promise.all(
						fileDiff.hunkSegments.map(async ({ start, end }) => {
							const text = fileDiff.lines
								.slice(start, end)
								.map((line) => line.highlightText)
								.join("\n");
							if (!text || isLargeContent(text)) return;

							try {
								const tokens = await requestHighlightTokens(
									text,
									fileDiff.language,
								);
								for (let i = 0; i < tokens.length && start + i < end; i++) {
									tokenLines[start + i] = tokens[i];
								}
							} catch {}
						}),
					);

					return [fileDiff.path, tokenLines] as const;
				}),
			);

			if (cancelled) return;

			const nextTokens: Record<string, ThemedToken[][]> = {};
			for (const [path, tokens] of highlights) {
				if (tokens) nextTokens[path] = tokens;
			}

			setLineTokensByPath(nextTokens);
		};

		run();

		return () => {
			cancelled = true;
		};
	}, [parsedFiles]);

	useEffect(() => {
		if (parsedFiles.length === 0) {
			setExpandedPaths({});
			return;
		}

		setExpandedPaths((previous) => {
			const next: Record<string, boolean> = {};
			for (const fileDiff of parsedFiles) {
				next[fileDiff.path] =
					previous[fileDiff.path] ?? fileDiff.lines.length <= 180;
			}
			return next;
		});
	}, [parsedFiles]);

	const setAll = (expanded: boolean) =>
		setExpandedPaths(
			Object.fromEntries(
				parsedFiles.map((fileDiff) => [fileDiff.path, expanded]),
			),
		);
	const totalAdditions = parsedFiles.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = parsedFiles.reduce((sum, f) => sum + f.deletions, 0);

	if (isLoading) {
		return (
			<div className="space-y-3" aria-busy="true">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="flex h-12 items-center gap-3 rounded-[18px] border border-bjork-border-muted bg-bjork-surface px-4"
					>
						<Skeleton className="size-4" />
						<Skeleton className="h-3.5" style={{ width: `${45 - i * 8}%` }} />
						<Skeleton className="ml-auto h-3.5 w-16" />
					</div>
				))}
			</div>
		);
	}

	if (parsedFiles.length === 0) {
		return <EmptyState message={emptyMessage || "No changes to display."} />;
	}

	return (
		<div className="space-y-3">
			<Toolbar>
				{summaryExtra ?? (
					<p className="text-sm text-bjork-text-muted">
						<span className="font-medium text-bjork-text">
							{parsedFiles.length} {parsedFiles.length === 1 ? "file" : "files"}
						</span>{" "}
						changed{" "}
						<span className="font-mono text-xs text-success tabular-nums">
							+{totalAdditions}
						</span>{" "}
						<span className="font-mono text-xs text-destructive tabular-nums">
							−{totalDeletions}
						</span>
					</p>
				)}
				<div className="flex items-center gap-2">
					{parsedFiles.length > 1 && (
						<div className="flex items-center">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setAll(true)}
								className="text-bjork-text-muted"
							>
								<ChevronsUpDown aria-hidden="true" />
								Expand all
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setAll(false)}
								className="text-bjork-text-muted"
							>
								<ChevronsDownUp aria-hidden="true" />
								Collapse all
							</Button>
						</div>
					)}
					{toolbarActions}
				</div>
			</Toolbar>
			{parsedFiles.map((fileDiff) => {
				const expanded = expandedPaths[fileDiff.path] ?? false;
				return (
					<section
						key={fileDiff.path}
						aria-label={fileDiff.path}
						className="rounded-[18px] border border-bjork-border-muted bg-bjork-surface shadow-(--bjork-shadow-surface)"
					>
						<button
							type="button"
							className={cn(
								"sticky top-16 z-10 flex min-h-12 w-full items-center justify-between gap-3 border-bjork-border-muted bg-bjork-surface-muted px-4 py-2.5 text-left backdrop-blur-xl transition-[background-color] duration-150 hover:bg-bjork-surface-hover",
								expanded ? "rounded-t-[17px] border-b" : "rounded-[17px]",
							)}
							onClick={() => {
								setExpandedPaths((previous) => ({
									...previous,
									[fileDiff.path]: !previous[fileDiff.path],
								}));
							}}
							aria-expanded={expanded}
						>
							<div className="flex min-w-0 items-center gap-2.5">
								<ChevronRight
									aria-hidden="true"
									className={cn(
										"size-4 shrink-0 text-bjork-text-soft transition-transform duration-200",
										expanded && "rotate-90",
									)}
								/>
								<span className="truncate font-mono text-[13px] text-bjork-text">
									{fileDiff.path}
								</span>
								<span
									className={cn(
										"shrink-0 text-xs capitalize",
										statusTone[fileDiff.status] ?? "text-bjork-text-soft",
									)}
								>
									{fileDiff.status}
								</span>
							</div>
							<div className="flex shrink-0 items-center gap-3 text-xs">
								{fileDiff.kind !== "text" ? (
									<span className="text-bjork-text-soft">
										{fileDiff.kind === "submodule"
											? "Submodule"
											: formatFileSize(
													fileDiff.newSize ?? fileDiff.oldSize ?? 0,
												)}
									</span>
								) : (
									<>
										<span className="font-mono tabular-nums">
											<span className="text-success">
												+{fileDiff.additions}
											</span>{" "}
											<span className="text-destructive">
												−{fileDiff.deletions}
											</span>
										</span>
										<DiffStat
											additions={fileDiff.additions}
											deletions={fileDiff.deletions}
										/>
									</>
								)}
							</div>
						</button>
						{expanded &&
							(fileDiff.kind === "submodule" ? (
								<div className="p-4">
									<SubmoduleDiff file={fileDiff} sides={sides} />
								</div>
							) : fileDiff.kind !== "text" ? (
								<div className="p-4">
									<UnpatchedDiff fileDiff={fileDiff} sides={sides} />
								</div>
							) : (
								<div className="diff-patch overflow-x-auto rounded-b-[17px] text-xs text-bjork-text">
									<div className="diff-patch-body">
										{fileDiff.lines.map((line, lineIndex) => {
											if (line.kind === "hunk") return null;
											const anchors = anchorsForLine(fileDiff.path, line);
											const primary = primaryAnchor(fileDiff.path, line);
											const threadContent = renderThreads
												? renderThreads(anchors)
												: null;
											return (
												<Fragment
													key={`${fileDiff.path}-${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${line.raw}`}
												>
													<div
														className={`diff-line diff-line--${line.kind} group/line`}
													>
														<span className="diff-gutter diff-gutter--old">
															{line.oldLine ?? ""}
														</span>
														<span className="diff-gutter diff-gutter--new">
															{line.newLine ?? ""}
														</span>
														<span className="diff-prefix">{line.prefix}</span>
														<span className="diff-code">
															{renderLineCode(
																line,
																lineTokensByPath[fileDiff.path]?.[lineIndex],
															)}
														</span>
														{renderLineActions && primary ? (
															<span className="diff-line-actions">
																{renderLineActions(primary)}
															</span>
														) : null}
													</div>
													{threadContent ? (
														<div className="diff-thread-row">
															{threadContent}
														</div>
													) : null}
												</Fragment>
											);
										})}
									</div>
								</div>
							))}
					</section>
				);
			})}
		</div>
	);
}

const statusTone: Record<string, string> = {
	added: "text-success",
	deleted: "text-destructive",
	renamed: "text-warning",
	modified: "text-bjork-text-soft",
};

/** GitHub's five-block diffstat: the share of added vs removed lines. */
function DiffStat({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	const total = additions + deletions;
	const added = total === 0 ? 0 : Math.round((additions / total) * 5);
	const removed =
		total === 0 ? 0 : Math.min(5 - added, Math.round((deletions / total) * 5));
	return (
		<span aria-hidden="true" className="hidden gap-0.5 sm:flex">
			{[0, 1, 2, 3, 4].map((i) => (
				<span
					key={i}
					className={cn(
						"size-2 rounded-[2px]",
						i < added
							? "bg-success"
							: i < added + removed
								? "bg-destructive"
								: "bg-bjork-surface-active",
					)}
				/>
			))}
		</span>
	);
}
