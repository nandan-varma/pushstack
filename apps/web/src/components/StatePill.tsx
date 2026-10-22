import {
	CircleCheck,
	CircleDot,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
	open: "border-success-border bg-success-soft text-success",
	done: "border-[color-mix(in_oklab,var(--merged)_35%,transparent)] bg-merged-soft text-merged",
	closed: "border-destructive/30 bg-destructive/10 text-destructive",
	neutral: "border-bjork-border bg-bjork-surface-active text-bjork-text-medium",
};

/**
 * A thread's state, the one coloured thing in its header: open is green,
 * completed issues and merged pull requests are purple, a closed pull
 * request is red — GitHub's semantics.
 */
export function StatePill({
	kind,
	status,
	className,
}: {
	kind: "issue" | "pull";
	status: string;
	className?: string;
}) {
	const [tone, Icon, label] =
		kind === "issue"
			? status === "open"
				? (["open", CircleDot, "Open"] as const)
				: (["done", CircleCheck, "Closed"] as const)
			: status === "open"
				? (["open", GitPullRequest, "Open"] as const)
				: status === "merged"
					? (["done", GitMerge, "Merged"] as const)
					: status === "draft"
						? (["neutral", GitPullRequestDraft, "Draft"] as const)
						: (["closed", GitPullRequestClosed, "Closed"] as const);
	return (
		<span
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
				tones[tone],
				className,
			)}
		>
			<Icon aria-hidden="true" className="size-4" />
			{label}
		</span>
	);
}
