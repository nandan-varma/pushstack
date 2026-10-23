import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { RelativeTime } from "@/components/RelativeTime";
import { formatFileSize } from "@/lib/language-detection";
import type { BlameView as BlameData } from "@/server/git-read";

type Props = {
	owner: string;
	name: string;
	filePath: string;
	blame: BlameData;
};

/**
 * Line ranges grouped by the commit that last changed them, like GitHub's
 * blame: author, age, message and sha beside the code, plus a link to the
 * blame as it was before that commit.
 */
export function BlameView({ owner, name, filePath, blame }: Props) {
	if (blame.kind === "binary") {
		return (
			<EmptyState
				title="Binary file"
				message="Blame is only available for text files."
			/>
		);
	}
	if (blame.kind === "too-large") {
		return (
			<EmptyState
				title="File too large to blame"
				message={
					blame.metric === "lines"
						? `Blame supports files up to ${blame.limit.toLocaleString()} lines. Clone the repository to blame it locally.`
						: `Blame supports files up to ${formatFileSize(blame.limit)}. Clone the repository to blame it locally.`
				}
			/>
		);
	}

	const fileName = filePath.split("/").pop() || filePath;
	return (
		<Panel aria-label={`Blame of ${fileName}`}>
			<PanelHeader>
				<span className="text-xs text-bjork-text-soft tabular-nums">
					{blame.lines.length} {blame.lines.length === 1 ? "line" : "lines"} ·{" "}
					{Object.keys(blame.commits).length}{" "}
					{Object.keys(blame.commits).length === 1 ? "commit" : "commits"}
				</span>
			</PanelHeader>
			{blame.truncated ? (
				<p
					role="status"
					className="border-b border-bjork-border-muted px-5 py-2 text-xs text-bjork-text-muted"
				>
					History is long: lines marked with an arrow may come from older
					commits than shown.
				</p>
			) : null}
			<div className="overflow-x-auto">
				<div className="min-w-[40rem]">
					{blame.ranges.map((range) => {
						const commit = blame.commits[range.sha];
						const lines = blame.lines.slice(range.startLine - 1, range.endLine);
						return (
							<div
								key={range.startLine}
								className="grid grid-cols-[minmax(11rem,18rem)_1fr] border-t border-bjork-border-muted first:border-t-0"
							>
								<div className="flex min-w-0 items-start gap-2 border-r border-bjork-border-muted px-3 py-1 text-xs">
									{commit ? (
										<div className="sticky top-0 min-w-0 flex-1 space-y-0.5 py-0.5">
											<Link
												to="/$owner/$name/commit/$sha"
												params={{ owner, name, sha: commit.sha }}
												title={commit.message}
												className="block truncate text-bjork-text hover:text-bjork-accent"
											>
												{commit.message.split("\n")[0]}
											</Link>
											<p className="flex items-center gap-x-1.5 truncate text-bjork-text-soft">
												<span className="truncate">{commit.authorName}</span>
												<span aria-hidden="true">·</span>
												<RelativeTime date={commit.createdAt} strict />
												{range.boundary ? (
													<span
														title="History limit reached: possibly older"
														role="img"
														aria-label="History limit reached"
													>
														↑
													</span>
												) : null}
											</p>
										</div>
									) : (
										<span className="text-bjork-text-soft">Unknown</span>
									)}
									{commit?.parentSha ? (
										<Link
											to="/$owner/$name/blame/$branch/$"
											params={{
												owner,
												name,
												branch: commit.parentSha,
												_splat: filePath,
											}}
											className="shrink-0 rounded-[6px] p-1 text-bjork-text-soft hover:text-bjork-accent"
											aria-label={`View blame before ${commit.sha.substring(0, 7)}`}
											title="View blame prior to this change"
										>
											<History className="size-3.5" />
										</Link>
									) : null}
								</div>
								<pre className="m-0 overflow-x-auto py-1 font-mono text-[13px] leading-[1.6]">
									{lines.map((line, i) => {
										const number = range.startLine + i;
										return (
											<div
												key={number}
												id={`L${number}`}
												className="flex whitespace-pre"
											>
												<span className="w-14 shrink-0 select-none pr-3 text-right text-bjork-text-soft tabular-nums">
													{number}
												</span>
												<code className="text-bjork-text-medium">
													{line || " "}
												</code>
											</div>
										);
									})}
								</pre>
							</div>
						);
					})}
				</div>
			</div>
		</Panel>
	);
}
