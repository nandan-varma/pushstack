import { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { Button } from "./ui/button";

/* Register supported languages for PrismLight */
import bash from "react-syntax-highlighter/dist/cjs/languages/prism/bash";
import c from "react-syntax-highlighter/dist/cjs/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/cjs/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/cjs/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/cjs/languages/prism/css";
import diff from "react-syntax-highlighter/dist/cjs/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/cjs/languages/prism/docker";
import go from "react-syntax-highlighter/dist/cjs/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/cjs/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/cjs/languages/prism/ini";
import java from "react-syntax-highlighter/dist/cjs/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/cjs/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/cjs/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/cjs/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/cjs/languages/prism/kotlin";
import less from "react-syntax-highlighter/dist/cjs/languages/prism/less";
import makefile from "react-syntax-highlighter/dist/cjs/languages/prism/makefile";
import markdown from "react-syntax-highlighter/dist/cjs/languages/prism/markdown";
import php from "react-syntax-highlighter/dist/cjs/languages/prism/php";
import protobuf from "react-syntax-highlighter/dist/cjs/languages/prism/protobuf";
import python from "react-syntax-highlighter/dist/cjs/languages/prism/python";
import r from "react-syntax-highlighter/dist/cjs/languages/prism/r";
import ruby from "react-syntax-highlighter/dist/cjs/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/cjs/languages/prism/rust";
import sass from "react-syntax-highlighter/dist/cjs/languages/prism/sass";
import scala from "react-syntax-highlighter/dist/cjs/languages/prism/scala";
import scss from "react-syntax-highlighter/dist/cjs/languages/prism/scss";
import sql from "react-syntax-highlighter/dist/cjs/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/cjs/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/cjs/languages/prism/toml";
import typescript from "react-syntax-highlighter/dist/cjs/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/cjs/languages/prism/tsx";
import vim from "react-syntax-highlighter/dist/cjs/languages/prism/vim";
import ydoc from "react-syntax-highlighter/dist/cjs/languages/prism/xml-doc";
import yaml from "react-syntax-highlighter/dist/cjs/languages/prism/yaml";

/* Register themes */
import oneDark from "react-syntax-highlighter/dist/cjs/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/cjs/styles/prism/one-light";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("c", c);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("docker", docker);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("graphql", graphql);
SyntaxHighlighter.registerLanguage("ini", ini);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("kotlin", kotlin);
SyntaxHighlighter.registerLanguage("less", less);
SyntaxHighlighter.registerLanguage("makefile", makefile);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("php", php);
SyntaxHighlighter.registerLanguage("protobuf", protobuf);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("r", r);
SyntaxHighlighter.registerLanguage("ruby", ruby);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("sass", sass);
SyntaxHighlighter.registerLanguage("scala", scala);
SyntaxHighlighter.registerLanguage("scss", scss);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("swift", swift);
SyntaxHighlighter.registerLanguage("toml", toml);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("vim", vim);
SyntaxHighlighter.registerLanguage("xml", ydoc);
SyntaxHighlighter.registerLanguage("yaml", yaml);

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
	const { copied, copy } = useCopyToClipboard();

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
						onClick={() => copy(code)}
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
