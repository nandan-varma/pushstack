import { lazy, Suspense } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { detectLanguage, formatFileSize } from "@/lib/language-detection";
import type { BlameView as BlameData } from "@/server/git-read";

const BlameCode = lazy(() => import("@/components/repo/BlameCode"));

type Props = {
	owner: string;
	name: string;
	filePath: string;
	blame: BlameData;
};

/**
 * Line ranges grouped by the commit that last changed them, like GitHub's
 * blame: author, age, message and sha beside highlighted code, plus a link to
 * the blame as it was before that commit. Files that are binary or beyond the
 * blame work budget render a plain state, not an error.
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
	const commitCount = Object.keys(blame.commits).length;
	return (
		<Panel aria-label={`Blame of ${fileName}`}>
			<PanelHeader>
				<span className="text-xs text-bjork-text-soft tabular-nums">
					{blame.lines.length} {blame.lines.length === 1 ? "line" : "lines"} ·{" "}
					{commitCount} {commitCount === 1 ? "commit" : "commits"}
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
			<Suspense fallback={<Skeleton className="m-5 h-96" />}>
				<BlameCode
					owner={owner}
					name={name}
					filePath={filePath}
					blame={blame}
					language={detectLanguage(filePath)}
				/>
			</Suspense>
		</Panel>
	);
}
