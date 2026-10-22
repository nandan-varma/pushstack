import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { countLines } from "@/lib/language-detection";

interface CodeViewerProps {
	code: string;
	language: string;
}

/** Matches `.code-viewer-html pre.shiki`: 13px type on a 1.6 line height. */
const LINE_HEIGHT_REM = 0.8125 * 1.6;
const VERTICAL_PADDING_REM = 0.875 + 1;

/**
 * Highlighted source with line numbers, flush inside its panel. Until the
 * highlighter answers, the exact height the code will take is reserved, so
 * nothing below it moves when it appears.
 */
export default function CodeViewer({ code, language }: CodeViewerProps) {
	const highlight = useHighlightedCode(code, language);
	const lineCount = countLines(code);

	if (highlight.status === "pending") {
		return (
			<div
				aria-busy="true"
				aria-label="Highlighting code"
				style={{
					height: `${lineCount * LINE_HEIGHT_REM + VERTICAL_PADDING_REM}rem`,
				}}
			/>
		);
	}

	if (highlight.status === "failed") {
		// Only when the highlighter itself fails: the code must stay readable.
		return (
			<pre className="m-0 overflow-x-auto px-5 py-3.5 font-mono text-[13px] leading-[1.6] whitespace-pre text-bjork-text-medium">
				<code>{code}</code>
			</pre>
		);
	}

	return (
		<div className="overflow-x-auto">
			<div
				className="code-viewer-html with-line-numbers"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is self-escaping HTML
				dangerouslySetInnerHTML={{ __html: highlight.html }}
			/>
		</div>
	);
}
