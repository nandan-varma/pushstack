import { GitMerge, GitPullRequestDraft } from "lucide-react";
import type { ReactNode } from "react";
import { Panel, PanelFooter } from "@/components/layout/panel";

/**
 * The merge decision at the foot of an open pull request's conversation:
 * what will happen, and the button that does it. A draft can't be merged, so
 * it offers "Ready for review" (`action`, shown to `canMarkReady`) instead.
 */
export function MergeBox({
	canMerge,
	draft = false,
	canMarkReady = false,
	sourceBranch,
	targetBranch,
	action,
}: {
	canMerge: boolean;
	draft?: boolean;
	canMarkReady?: boolean;
	sourceBranch: string;
	targetBranch: string;
	action?: ReactNode;
}) {
	if (draft) {
		return (
			<Panel>
				<div className="flex items-start gap-4 p-5">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-bjork-surface-active text-bjork-text-medium">
						<GitPullRequestDraft aria-hidden="true" className="size-5" />
					</div>
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-bjork-text">
							This pull request is still a draft
						</h2>
						<p className="mt-1 text-[13px] leading-5 text-bjork-text-muted">
							Draft pull requests can't be merged. Mark it ready for review when
							it is done.
						</p>
					</div>
				</div>
				{canMarkReady && action && <PanelFooter>{action}</PanelFooter>}
			</Panel>
		);
	}
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
			{canMerge && action && <PanelFooter>{action}</PanelFooter>}
		</Panel>
	);
}
