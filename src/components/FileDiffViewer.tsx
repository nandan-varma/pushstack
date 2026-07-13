import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ThemedToken } from "shiki";
import { detectLanguage, isLargeContent } from "@/lib/language-detection";
import { requestHighlightTokens } from "@/lib/syntax-highlight-client";
import { Skeleton } from "@/components/ui/skeleton";

interface FileDiff {
	path: string;
	status: string;
	patch: string;
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

interface ParsedFileDiff extends FileDiff {
	language: string;
	lines: ParsedDiffLine[];
	highlightSource: string;
	additions: number;
	deletions: number;
	hunks: number;
}

const HUNK_HEADER_RE = /^@@\s-([0-9]+)(?:,[0-9]+)?\s\+([0-9]+)(?:,[0-9]+)?\s@@/;

function classifyLine(raw: string): DiffLineKind {
	if (raw.startsWith("@@")) return "hunk";

	if (
		raw.startsWith("diff --git") ||
		raw.startsWith("index ") ||
		raw.startsWith("new file mode") ||
		raw.startsWith("deleted file mode") ||
		raw.startsWith("rename from ") ||
		raw.startsWith("rename to ") ||
		raw.startsWith("similarity index") ||
		raw.startsWith("--- ") ||
		raw.startsWith("+++ ") ||
		raw.startsWith("\\ No newline at end of file")
	) {
		return "meta";
	}

	if (raw.startsWith("+")) return "add";
	if (raw.startsWith("-")) return "remove";

	return "context";
}

function parsePatch(patch: string): ParsedDiffLine[] {
	const rows = patch.split("\n");
	let oldLine = 1;
	let newLine = 1;

	return rows.map((raw) => {
		const kind = classifyLine(raw);

		if (kind === "hunk") {
			const match = raw.match(HUNK_HEADER_RE);
			if (match) {
				oldLine = Number(match[1]);
				newLine = Number(match[2]);
			}

			return {
				raw,
				kind,
				prefix: "",
				code: raw,
				highlightText: "",
				oldLine: null,
				newLine: null,
			};
		}

		if (kind === "meta") {
			return {
				raw,
				kind,
				prefix: "",
				code: raw,
				highlightText: "",
				oldLine: null,
				newLine: null,
			};
		}

		if (kind === "add") {
			const nextNew = newLine;
			newLine += 1;

			return {
				raw,
				kind,
				prefix: "+",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: null,
				newLine: nextNew,
			};
		}

		if (kind === "remove") {
			const nextOld = oldLine;
			oldLine += 1;

			return {
				raw,
				kind,
				prefix: "-",
				code: raw.slice(1),
				highlightText: raw.slice(1),
				oldLine: nextOld,
				newLine: null,
			};
		}

		const nextOld = oldLine;
		const nextNew = newLine;
		oldLine += 1;
		newLine += 1;

		return {
			raw,
			kind,
			prefix: raw.startsWith(" ") ? " " : "",
			code: raw.startsWith(" ") ? raw.slice(1) : raw,
			highlightText: raw.startsWith(" ") ? raw.slice(1) : raw,
			oldLine: nextOld,
			newLine: nextNew,
		};
	});
}

function tokenStyle(token: ThemedToken): CSSProperties {
	const style: CSSProperties = {};
	if (token.color) style.color = token.color;

	const fontStyle = token.fontStyle ?? 0;
	if (fontStyle & 1) style.fontStyle = "italic";
	if (fontStyle & 2) style.fontWeight = 600;
	if (fontStyle & 4) style.textDecoration = "underline";

	return style;
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
				const additions = lines.filter((line) => line.kind === "add").length;
				const deletions = lines.filter((line) => line.kind === "remove").length;
				const hunks = lines.filter((line) => line.kind === "hunk").length;

				return {
					...fileDiff,
					language: detectLanguage(fileDiff.path),
					lines,
					highlightSource: lines.map((line) => line.highlightText).join("\n"),
					additions,
					deletions,
					hunks,
				};
			}),
		[files],
	);

	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

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
						!fileDiff.highlightSource ||
						isLargeContent(fileDiff.highlightSource)
					) {
						return [fileDiff.path, null] as const;
					}

					try {
						const tokens = await requestHighlightTokens(
							fileDiff.highlightSource,
							fileDiff.language,
						);
						return [fileDiff.path, tokens] as const;
					} catch {
						return [fileDiff.path, null] as const;
					}
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
							<code className="truncate text-sm font-medium text-[var(--sea-ink)]">
								{fileDiff.path}
							</code>
						</div>
						<div className="flex shrink-0 items-center gap-2 text-xs">
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink-soft)]">
								+{fileDiff.additions}
							</span>
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink-soft)]">
								-{fileDiff.deletions}
							</span>
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2 py-0.5 uppercase tracking-wide text-[var(--sea-ink-soft)]">
								{fileDiff.status}
							</span>
						</div>
					</button>
					{expandedPaths[fileDiff.path] ? (
						<div className="px-4 pb-4">
							<pre className="diff-patch diff-scroll-area overflow-x-auto rounded border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-xs text-[var(--sea-ink)]">
								<code>
									{fileDiff.lines.map((line, lineIndex) => (
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
									))}
								</code>
							</pre>
						</div>
					) : (
						<p className="px-4 pb-4 text-xs text-[var(--sea-ink-soft)]">
							{fileDiff.lines.length} lines changed across {fileDiff.hunks} hunk
							{fileDiff.hunks === 1 ? "" : "s"}.
						</p>
					)}
				</div>
			))}
		</div>
	);
}
