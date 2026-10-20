import type { DiffFile } from "git-fs-s3/ops";
import { ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";
import { BinaryPreview } from "@/components/BinaryPreview";
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
import { SubmoduleDiff } from "./SubmoduleDiff";

type FileDiff = DiffFile;

/** Where each side of the diff lives, so media can be fetched from /api/raw. */
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

/** A diff with no patch: binary (previewed side by side) or too large. */
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
	renderLineActions,
	renderThreads,
}: {
	files?: FileDiff[];
	/** Needed to preview binary media; without it they're summarized. */
	sides?: DiffSides;
	isLoading?: boolean;
	emptyMessage?: string;
	summaryExtra?: ReactNode;
	/** A per-line control (e.g. a "comment" button), rendered after the code. */
	renderLineActions?: (anchor: DiffAnchor) => ReactNode;
	/** The threads anchored to a line, rendered as a full-width row below it. */
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
							} catch {
								// leave this segment's lines unhighlighted
							}
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

	if (isLoading) {
		return (
			<div className="mt-4 space-y-3">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3"
					>
						<div className="flex min-w-0 flex-1 items-center gap-2.5">
							<div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
							<div
								className="h-3.5 animate-pulse rounded bg-muted"
								style={{ width: `${45 - i * 8}%` }}
							/>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<div className="h-4 w-9 animate-pulse rounded-full bg-muted" />
							<div className="h-4 w-9 animate-pulse rounded-full bg-muted" />
						</div>
					</div>
				))}
			</div>
		);
	}

	if (parsedFiles.length === 0) {
		return (
			<p className="mt-4 text-sm text-muted-foreground">
				{emptyMessage || "No changes to display."}
			</p>
		);
	}

	return (
		<div className="mt-4 space-y-4">
			<div className="diff-viewer-toolbar flex flex-wrap items-center justify-between gap-2">
				{summaryExtra}
				{parsedFiles.length > 1 ? (
					<div className="flex items-center gap-2 text-xs">
						<button
							type="button"
							className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground"
							onClick={() => {
								setExpandedPaths(
									Object.fromEntries(
										parsedFiles.map((fileDiff) => [fileDiff.path, true]),
									),
								);
							}}
						>
							Expand all
						</button>
						<button
							type="button"
							className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground"
							onClick={() => {
								setExpandedPaths(
									Object.fromEntries(
										parsedFiles.map((fileDiff) => [fileDiff.path, false]),
									),
								);
							}}
						>
							Collapse all
						</button>
					</div>
				) : null}
			</div>
			{parsedFiles.map((fileDiff) => (
				<div
					key={fileDiff.path}
					className="diff-file-card rounded-lg border border-border bg-background"
				>
					<button
						type="button"
						className="diff-file-header flex w-full items-center justify-between gap-3 rounded-t-lg px-4 py-3 text-left"
						onClick={() => {
							setExpandedPaths((previous) => ({
								...previous,
								[fileDiff.path]: !previous[fileDiff.path],
							}));
						}}
						aria-expanded={expandedPaths[fileDiff.path] ?? false}
					>
						<div className="flex min-w-0 items-center gap-2.5">
							<ChevronRight
								className={`size-4 shrink-0 text-muted-foreground transition-transform ${expandedPaths[fileDiff.path] ? "rotate-90" : ""}`}
							/>
							<span className="truncate text-sm font-medium text-foreground">
								{fileDiff.path}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-2 text-xs">
							{fileDiff.kind !== "text" ? (
								<span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
									{fileDiff.kind === "submodule"
										? "Submodule"
										: formatFileSize(fileDiff.newSize ?? fileDiff.oldSize ?? 0)}
								</span>
							) : (
								<>
									<span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
										+{fileDiff.additions}
									</span>
									<span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
										-{fileDiff.deletions}
									</span>
								</>
							)}
							<span className="rounded-full border border-border bg-muted px-2 py-0.5 uppercase tracking-wide text-muted-foreground">
								{fileDiff.status}
							</span>
						</div>
					</button>
					{expandedPaths[fileDiff.path] ? (
						<div className="px-4 p-4">
							{fileDiff.kind === "submodule" ? (
								<SubmoduleDiff file={fileDiff} sides={sides} />
							) : fileDiff.kind !== "text" ? (
								<UnpatchedDiff fileDiff={fileDiff} sides={sides} />
							) : (
								<div className="diff-patch diff-scroll-area overflow-x-auto rounded border border-border bg-muted p-0 text-xs text-foreground">
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
													<div className={`diff-line diff-line--${line.kind}`}>
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
							)}
						</div>
					) : (
						<p className="p-4 text-xs text-muted-foreground">
							{fileDiff.kind === "submodule"
								? "Submodule pointer changed."
								: fileDiff.kind === "binary"
									? "Binary file changed."
									: fileDiff.kind === "too-large"
										? "Large file changed — diff not shown."
										: `${fileDiff.visibleLineCount} lines changed across ${fileDiff.hunks} hunk${fileDiff.hunks === 1 ? "" : "s"}.`}
						</p>
					)}
				</div>
			))}
		</div>
	);
}
