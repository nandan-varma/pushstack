import { ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";
import { BinaryPreview } from "@/components/BinaryPreview";
import { Skeleton } from "@/components/ui/skeleton";
import {
	detectLanguage,
	formatFileSize,
	getMimeType,
	getPreviewKind,
	isLargeContent,
} from "@/lib/language-detection";
import { requestHighlightTokens } from "@/lib/syntax-highlight-client";

interface FileDiff {
	path: string;
	status: string;
	patch: string;
	isBinary?: boolean;
	oldContent?: string;
	newContent?: string;
	oldSize?: number;
	newSize?: number;
}

function BinaryDiffSide({
	label,
	content,
	size,
	path,
}: {
	label: string;
	content: string | undefined;
	size: number | undefined;
	path: string;
}) {
	const previewKind = getPreviewKind(path);

	return (
		<div className="min-w-0">
			<p className="mb-2 text-xs font-medium text-[var(--sea-ink-soft)]">
				{label}
				{size !== undefined ? ` · ${formatFileSize(size)}` : ""}
			</p>
			{content && previewKind ? (
				<BinaryPreview
					data={content}
					mimeType={getMimeType(path)}
					previewKind={previewKind}
					fileName={path}
				/>
			) : (
				<div className="rounded-md border border-dashed border-[var(--line)] bg-[var(--chip-bg)] p-6 text-center text-xs text-[var(--sea-ink-soft)]">
					No file
				</div>
			)}
		</div>
	);
}

function BinaryDiffPreview({ fileDiff }: { fileDiff: FileDiff }) {
	const previewKind = getPreviewKind(fileDiff.path);

	if (!previewKind) {
		return (
			<p className="text-xs text-[var(--sea-ink-soft)]">
				Binary file changed
				{fileDiff.oldSize !== undefined || fileDiff.newSize !== undefined
					? ` (${fileDiff.oldSize !== undefined ? formatFileSize(fileDiff.oldSize) : "—"} → ${fileDiff.newSize !== undefined ? formatFileSize(fileDiff.newSize) : "—"})`
					: ""}
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<BinaryDiffSide
				label="Before"
				content={fileDiff.oldContent}
				size={fileDiff.oldSize}
				path={fileDiff.path}
			/>
			<BinaryDiffSide
				label="After"
				content={fileDiff.newContent}
				size={fileDiff.newSize}
				path={fileDiff.path}
			/>
		</div>
	);
}

type DiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

interface ParsedDiffLine {
	raw: string;
	kind: DiffLineKind;
	prefix: string;
	code: string;
	highlightText: string;
	oldLine: number | null;
	newLine: number | null;
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

const HUNK_HEADER_RE = /^@@\s-([0-9]+)(?:,[0-9]+)?\s\+([0-9]+)(?:,[0-9]+)?\s@@/;

function classifyLine(raw: string): DiffLineKind {
	if (raw.startsWith("@@")) return "hunk";

	if (raw.startsWith("+")) return "add";
	if (raw.startsWith("-")) return "remove";
	if (raw.startsWith("\\")) return "meta";

	return "context";
}

function parsePatch(patch: string): ParsedDiffLine[] {
	const normalized = patch.replace(/\r\n/g, "\n");
	if (!normalized) return [];
	const rows = normalized.endsWith("\n")
		? normalized.slice(0, -1).split("\n")
		: normalized.split("\n");
	let oldLine = 1;
	let newLine = 1;
	let inHunk = false;

	const parsed: ParsedDiffLine[] = [];

	for (const raw of rows) {
		const kind = classifyLine(raw);

		if (kind === "hunk") {
			const match = raw.match(HUNK_HEADER_RE);
			if (match) {
				oldLine = Number(match[1]);
				newLine = Number(match[2]);
			}
			inHunk = true;
			parsed.push({
				raw,
				kind,
				prefix: "",
				code: raw,
				highlightText: "",
				oldLine: null,
				newLine: null,
			});
			continue;
		}

		// Unified diff metadata (file headers, modes, rename info) always
		// appears before hunks; skip it generically instead of hardcoding labels.
		if (!inHunk || kind === "meta") {
			continue;
		}

		if (kind === "add") {
			const nextNew = newLine;
			newLine += 1;
			parsed.push({
				raw,
				kind,
				prefix: "+",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: null,
				newLine: nextNew,
			});
			continue;
		}

		if (kind === "remove") {
			const nextOld = oldLine;
			oldLine += 1;
			parsed.push({
				raw,
				kind,
				prefix: "-",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: nextOld,
				newLine: null,
			});
			continue;
		}

		const nextOld = oldLine;
		const nextNew = newLine;
		oldLine += 1;
		newLine += 1;
		parsed.push({
			raw,
			kind,
			prefix: raw.startsWith(" ") ? " " : "",
			code: raw.startsWith(" ") ? raw.slice(1) : raw,
			highlightText: raw.startsWith(" ") ? raw.slice(1) : raw,
			oldLine: nextOld,
			newLine: nextNew,
		});
	}

	return parsed;
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
	isLoading,
	emptyMessage,
	summaryExtra,
}: {
	files?: FileDiff[];
	isLoading?: boolean;
	emptyMessage?: string;
	summaryExtra?: ReactNode;
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
					if (fileDiff.hunkSegments.length === 0) {
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
		return <Skeleton className="h-48" />;
	}

	if (parsedFiles.length === 0) {
		return (
			<p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
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
							className="rounded-md border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
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
							className="rounded-md border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
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
					className="diff-file-card rounded-lg border border-[var(--line)] bg-[var(--surface)]"
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
								className={`size-4 shrink-0 text-[var(--sea-ink-soft)] transition-transform ${expandedPaths[fileDiff.path] ? "rotate-90" : ""}`}
							/>
							<span className="truncate text-sm font-medium text-[var(--sea-ink)]">
								{fileDiff.path}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-2 text-xs">
							{fileDiff.isBinary ? (
								<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink-soft)]">
									{formatFileSize(fileDiff.newSize ?? fileDiff.oldSize ?? 0)}
								</span>
							) : (
								<>
									<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink-soft)]">
										+{fileDiff.additions}
									</span>
									<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink-soft)]">
										-{fileDiff.deletions}
									</span>
								</>
							)}
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 uppercase tracking-wide text-[var(--sea-ink-soft)]">
								{fileDiff.status}
							</span>
						</div>
					</button>
					{expandedPaths[fileDiff.path] ? (
						<div className="px-4 p-4">
							{fileDiff.isBinary ? (
								<BinaryDiffPreview fileDiff={fileDiff} />
							) : (
								<pre className="diff-patch diff-scroll-area overflow-x-auto rounded border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-xs text-[var(--sea-ink)]">
									<code>
										{fileDiff.lines.map((line, lineIndex) =>
											line.kind === "hunk" ? null : (
												<div
													key={`${fileDiff.path}-${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${line.raw}`}
													className={`diff-line diff-line--${line.kind}`}
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
												</div>
											),
										)}
									</code>
								</pre>
							)}
						</div>
					) : (
						<p className="p-4 text-xs text-[var(--sea-ink-soft)]">
							{fileDiff.isBinary
								? "Binary file changed."
								: `${fileDiff.visibleLineCount} lines changed across ${fileDiff.hunks} hunk${fileDiff.hunks === 1 ? "" : "s"}.`}
						</p>
					)}
				</div>
			))}
		</div>
	);
}
