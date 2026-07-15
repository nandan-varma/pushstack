import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** GitHub-style "this branch has new commits" notice — see useBranchUpdateBanner. */
export function BranchUpdateBanner({
	branchName,
	onReload,
	isReloading,
}: {
	branchName: string;
	onReload: () => void;
	isReloading?: boolean;
}) {
	return (
		<div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--lagoon)]/40 bg-[color-mix(in_oklab,var(--lagoon)_10%,transparent)] px-4 py-2.5 text-sm text-[var(--sea-ink)]">
			<span>
				This branch (<code className="font-mono">{branchName}</code>) has new
				commits.
			</span>
			<Button
				size="sm"
				variant="outline"
				onClick={onReload}
				disabled={isReloading}
			>
				<RefreshCw
					className={`size-3.5 ${isReloading ? "animate-spin" : ""}`}
				/>
				{isReloading ? "Reloading…" : "Reload"}
			</Button>
		</div>
	);
}
