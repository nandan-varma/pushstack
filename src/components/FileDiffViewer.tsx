import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
	const parsedFiles = useMemo(
		() =>
			(files ?? []).map((fileDiff) => {
				const lines = parsePatch(fileDiff.patch);
				return {
					...fileDiff,
					language: detectLanguage(fileDiff.path),
					lines,
					highlightSource: lines.map((line) => line.highlightText).join("\n"),
				};
			}),
		[files],
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
			{summaryExtra}
			{parsedFiles.map((fileDiff) => (
				<div
					key={fileDiff.path}
					className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
				>
					<div className="mb-3 flex items-center justify-between">
						<code className="text-sm font-medium text-[var(--sea-ink)]">
							{fileDiff.path}
						</code>
						<span className="text-xs uppercase text-[var(--sea-ink-soft)]">
							{fileDiff.status}
						</span>
					</div>
					<pre className="diff-patch overflow-x-auto rounded border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-xs text-[var(--sea-ink)]">
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
			))}
		</div>
	);
}
