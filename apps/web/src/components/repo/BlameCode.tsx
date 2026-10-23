import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import type { BlameView } from "@/server/git-read";

type Blame = Extract<BlameView, { kind: "blame" }>;

/** Matches `.code-viewer-html pre.shiki`: 13px type on a 1.6 line height. */
const LINE_HEIGHT_REM = 0.8125 * 1.6;
/** The code block's top padding, which the blame column must mirror. */
const TOP_PADDING_REM = 0.875;
const BOTTOM_PADDING_REM = 1;

/**
 * The blame column beside the same Shiki-highlighted, line-numbered code the
 * file view shows. Both columns use one fixed line height, so each range's
 * cell is exactly as tall as its lines; until the highlighter answers, the
 * full height is reserved so nothing moves.
 */
export default function BlameCode({
	owner,
	name,
	filePath,
	blame,
	language,
}: {
	owner: string;
	name: string;
	filePath: string;
	blame: Blame;
	language: string;
}) {
	const code = blame.lines.join("\n");
	const highlight = useHighlightedCode(code, language);
	const totalRem =
		blame.lines.length * LINE_HEIGHT_REM + TOP_PADDING_REM + BOTTOM_PADDING_REM;

	return (
		<div className="grid grid-cols-[minmax(9rem,16rem)_minmax(0,1fr)]">
			<div
				className="border-r border-bjork-border-muted"
				style={{ paddingTop: `${TOP_PADDING_REM}rem` }}
			>
				{blame.ranges.map((range) => {
					const commit = blame.commits[range.sha];
					const lineCount = range.endLine - range.startLine + 1;
					return (
						<div
							key={range.startLine}
							id={`L${range.startLine}`}
							className="flex items-start gap-1 overflow-hidden border-t border-bjork-border-muted px-3 text-xs first:border-t-0"
							style={{ height: `${lineCount * LINE_HEIGHT_REM}rem` }}
						>
							{commit ? (
								<div className="min-w-0 flex-1 leading-[1.3rem]">
									<Link
										to="/$owner/$name/commit/$sha"
										params={{ owner, name, sha: commit.sha }}
										title={commit.message}
										className="block truncate text-bjork-text hover:text-bjork-accent"
									>
										{commit.message.split("\n")[0]}
									</Link>
									{lineCount > 1 ? (
										<p className="flex items-center gap-x-1.5 truncate leading-[1.3rem] text-bjork-text-soft">
											<span className="truncate">{commit.authorName}</span>
											<span aria-hidden="true">·</span>
											<RelativeTime date={commit.createdAt} strict />
										</p>
									) : null}
								</div>
							) : (
								<span className="text-bjork-text-soft leading-[1.3rem]">
									Unknown
								</span>
							)}
							{range.boundary ? (
								<span
									className="shrink-0 leading-[1.3rem] text-bjork-text-soft"
									title="History limit reached: possibly older"
									role="img"
									aria-label="History limit reached"
								>
									↑
								</span>
							) : null}
							{commit?.parentSha ? (
								<Link
									to="/$owner/$name/blame/$branch/$"
									params={{
										owner,
										name,
										branch: commit.parentSha,
										_splat: filePath,
									}}
									className="shrink-0 rounded-[6px] p-0.5 leading-[1.3rem] text-bjork-text-soft hover:text-bjork-accent"
									aria-label={`View blame before ${commit.sha.substring(0, 7)}`}
									title="View blame prior to this change"
								>
									<History className="size-3.5" />
								</Link>
							) : null}
						</div>
					);
				})}
			</div>
			<div className="min-w-0 overflow-x-auto">
				{highlight.status === "pending" ? (
					<div
						role="status"
						aria-busy="true"
						aria-label="Highlighting code"
						style={{ height: `${totalRem}rem` }}
					/>
				) : highlight.status === "failed" ? (
					<pre className="m-0 px-5 py-3.5 font-mono text-[13px] leading-[1.6] whitespace-pre text-bjork-text-medium">
						<code>{code}</code>
					</pre>
				) : (
					<div
						className="code-viewer-html with-line-numbers"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is self-escaping HTML
						dangerouslySetInnerHTML={{ __html: highlight.html }}
					/>
				)}
			</div>
		</div>
	);
}
