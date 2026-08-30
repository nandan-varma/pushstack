import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { isLargeContent } from "@/lib/language-detection";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface CodeViewerProps {
	code: string;
	language: string;
	showLineNumbers?: boolean;
	fileName?: string;
	maxHeight?: string;
}

export default function CodeViewer({
	code,
	language,
	showLineNumbers = true,
	fileName,
	maxHeight = "600px",
}: CodeViewerProps) {
	const { copied, copy } = useCopyToClipboard();
	const [forceHighlight, setForceHighlight] = useState(false);

	const isLarge = isLargeContent(code);
	const { html, isPending } = useHighlightedCode(
		code,
		language,
		!isLarge || forceHighlight,
	);

	return (
		<div className="rounded-lg border border-border overflow-hidden">
			<div className="flex items-center justify-between bg-card px-4 py-2 border-b border-border">
				<div className="flex items-center gap-2">
					{fileName && (
						<span className="max-w-xs truncate text-sm font-medium text-foreground">
							{fileName}
						</span>
					)}
					<span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted border border-border">
						{language}
					</span>
					{isPending && (
						<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
					)}
				</div>
				<div className="flex items-center gap-2">
					{isLarge && !forceHighlight && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setForceHighlight(true)}
						>
							Highlight anyway
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => copy(code)}
						disabled={copied}
					>
						{copied ? (
							<>
								<Check className="size-4" /> Copied
							</>
						) : (
							<>
								<Copy className="size-4" /> Copy
							</>
						)}
					</Button>
				</div>
			</div>

			{isLarge && !forceHighlight && (
				<p className="px-4 py-2 text-xs text-muted-foreground bg-muted border-b border-border">
					This file is large, so syntax highlighting was skipped to keep things
					fast. Click "Highlight anyway" to enable it.
				</p>
			)}

			<div style={{ maxHeight, overflow: "auto" }}>
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
					<pre className="m-0 w-max min-w-full p-4 text-sm leading-relaxed text-foreground bg-background whitespace-pre">
						<code>{code}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
