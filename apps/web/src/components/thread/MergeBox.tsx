import { GitMerge } from "lucide-react";
import type { ReactNode } from "react";
import { Panel, PanelFooter } from "@/components/layout/panel";
import { CommitChecks } from "@/components/repo/Checks";

/**
 * The merge decision at the foot of an open pull request's conversation:
 * what will happen, and the button that does it.
 */
export function MergeBox({
	canMerge,
	sourceBranch,
	targetBranch,
	action,
	repoId,
}: {
	canMerge: boolean;
	sourceBranch: string;
	targetBranch: string;
	action?: ReactNode;
	/** With it, the CI results for the source branch's tip show above the button. */
	repoId?: number;
}) {
	return (
		<Panel className="border-success-border">
			<div className="flex items-start gap-4 p-5">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-success-soft text-success">
					<GitMerge aria-hidden="true" className="size-5" />
				</div>
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-bjork-text">
						{canMerge
							? "Ready to merge"
							: "Merging is limited to people with write access"}
					</h2>
					<p className="mt-1 text-[13px] leading-5 text-bjork-text-muted">
						Merges <span className="font-mono text-xs">{sourceBranch}</span>{" "}
						into <span className="font-mono text-xs">{targetBranch}</span>.
						Conflicts are checked when you merge.
					</p>
				</div>
			</div>
			{repoId !== undefined && (
				<CommitChecks repoId={repoId} rev={sourceBranch} embedded />
			)}
			{canMerge && action && <PanelFooter>{action}</PanelFooter>}
		</Panel>
	);
}
