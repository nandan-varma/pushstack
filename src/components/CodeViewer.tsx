import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
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
	const [theme, setTheme] = useState<"dark" | "light">("dark");
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const toggleTheme = () => {
		setTheme(theme === "dark" ? "light" : "dark");
	};

	return (
		<div className="rounded-lg border border-[var(--line)] overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between bg-[var(--card-bg)] px-4 py-2 border-b border-[var(--line)]">
				<div className="flex items-center gap-2">
					{fileName && (
						<span className="text-sm font-medium text-[var(--sea-ink)]">
							{fileName}
						</span>
					)}
					<span className="text-xs text-[var(--sea-ink-soft)] px-2 py-0.5 rounded bg-[var(--chip-bg)] border border-[var(--chip-line)]">
						{language}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={toggleTheme}
						title="Toggle theme"
					>
						{theme === "dark" ? "☀️" : "🌙"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={handleCopy}
						disabled={copied}
					>
						{copied ? "✓ Copied" : "📋 Copy"}
					</Button>
				</div>
			</div>

			{/* Code */}
			<div style={{ maxHeight, overflow: "auto" }}>
				<SyntaxHighlighter
					language={language}
					style={theme === "dark" ? oneDark : oneLight}
					showLineNumbers={showLineNumbers}
					customStyle={{
						margin: 0,
						padding: "1rem",
						fontSize: "0.875rem",
						lineHeight: "1.5",
					}}
					lineNumberStyle={{
						minWidth: "3em",
						paddingRight: "1em",
						color: theme === "dark" ? "#6272a4" : "#999",
						textAlign: "right",
						userSelect: "none",
					}}
				>
					{code}
				</SyntaxHighlighter>
			</div>
		</div>
	);
}
