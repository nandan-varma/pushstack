import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Button } from "./ui/button";

interface DiffViewerProps {
	oldValue: string;
	newValue: string;
	oldTitle?: string;
	newTitle?: string;
	fileName?: string;
	language?: string;
}

export default function DiffViewer({
	oldValue,
	newValue,
	oldTitle = "Original",
	newTitle = "Modified",
	fileName,
}: DiffViewerProps) {
	const [splitView, setSplitView] = useState(true);
	const [theme, setTheme] = useState<"dark" | "light">("dark");

	const toggleView = () => setSplitView(!splitView);
	const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

	// Calculate diff stats
	const lines = newValue.split("\n");
	const oldLines = oldValue.split("\n");
	const additions = lines.filter(
		(line, i) => line !== oldLines[i] && i >= oldLines.length,
	).length;
	const deletions = oldLines.filter(
		(line, i) => line !== lines[i] && i >= lines.length,
	).length;

	return (
		<div className="rounded-lg border border-[var(--line)] overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between bg-[var(--card-bg)] px-4 py-2 border-b border-[var(--line)]">
				<div className="flex items-center gap-3">
					{fileName && (
						<span className="text-sm font-medium text-[var(--sea-ink)]">
							{fileName}
						</span>
					)}
					<div className="flex items-center gap-2 text-xs">
						{additions > 0 && (
							<span className="text-green-600 dark:text-green-400">
								+{additions}
							</span>
						)}
						{deletions > 0 && (
							<span className="text-red-600 dark:text-red-400">
								-{deletions}
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={toggleTheme}>
						{theme === "dark" ? "☀️" : "🌙"}
					</Button>
					<Button variant="outline" size="sm" onClick={toggleView}>
						{splitView ? "📄 Unified" : "📋 Split"}
					</Button>
				</div>
			</div>

			{/* Diff */}
			<div className="overflow-auto max-h-[600px]">
				<ReactDiffViewer
					oldValue={oldValue}
					newValue={newValue}
					splitView={splitView}
					compareMethod={DiffMethod.WORDS}
					leftTitle={oldTitle}
					rightTitle={newTitle}
					useDarkTheme={theme === "dark"}
					styles={{
						variables: {
							dark: {
								diffViewerBackground: "#1e1e1e",
								diffViewerColor: "#e0e0e0",
								addedBackground: "#044B53",
								addedColor: "#e0e0e0",
								removedBackground: "#5D2A2F",
								removedColor: "#e0e0e0",
								wordAddedBackground: "#055d67",
								wordRemovedBackground: "#7d383f",
								addedGutterBackground: "#034148",
								removedGutterBackground: "#4d1f24",
								gutterBackground: "#2d2d2d",
								gutterBackgroundDark: "#262626",
								highlightBackground: "#2a3f5f",
								highlightGutterBackground: "#2d4566",
							},
							light: {
								diffViewerBackground: "#fff",
								diffViewerColor: "#212529",
								addedBackground: "#e6ffed",
								addedColor: "#24292e",
								removedBackground: "#ffeef0",
								removedColor: "#24292e",
								wordAddedBackground: "#acf2bd",
								wordRemovedBackground: "#fdb8c0",
								addedGutterBackground: "#cdffd8",
								removedGutterBackground: "#ffdce0",
								gutterBackground: "#f7f7f7",
								gutterBackgroundDark: "#f3f3f3",
								highlightBackground: "#fffbdd",
								highlightGutterBackground: "#fff5b1",
							},
						},
						line: {
							fontSize: "0.875rem",
							lineHeight: "1.5",
						},
					}}
				/>
			</div>
		</div>
	);
}
