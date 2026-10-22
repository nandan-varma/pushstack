import { useState } from "react";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { isLargeContent } from "@/lib/language-detection";
import { cn } from "@/lib/utils";

interface CodeViewerProps {
	code: string;
	language: string;
	showLineNumbers?: boolean;
}

/**
 * Highlighted source, flush inside its panel (the panel header carries the
 * file's name and actions). It grows with the page instead of scrolling in a
 * box of its own; long lines scroll sideways under a sticky gutter.
 */
export default function CodeViewer({
	code,
	language,
	showLineNumbers = true,
}: CodeViewerProps) {
	const [forceHighlight, setForceHighlight] = useState(false);

	const isLarge = isLargeContent(code);
	const { html } = useHighlightedCode(
		code,
		language,
		!isLarge || forceHighlight,
	);

	return (
		<>
			{isLarge && !forceHighlight && (
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bjork-border-muted bg-bjork-panel px-5 py-2.5 text-xs text-bjork-text-muted">
					Syntax highlighting is off for large files to keep them fast.
					<button
						type="button"
						onClick={() => setForceHighlight(true)}
						className="font-medium text-bjork-accent hover:underline"
					>
						Highlight anyway
					</button>
				</p>
			)}
			<div className="overflow-x-auto">
				{html ? (
					<div
						className={cn(
							"code-viewer-html",
							showLineNumbers && "with-line-numbers",
						)}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is self-escaping HTML
						dangerouslySetInnerHTML={{ __html: html }}
					/>
				) : (
					<pre className="m-0 w-max min-w-full px-5 py-4 font-mono text-[13px] leading-[1.6] text-bjork-text-medium whitespace-pre">
						<code>{code}</code>
					</pre>
				)}
			</div>
		</>
	);
}
