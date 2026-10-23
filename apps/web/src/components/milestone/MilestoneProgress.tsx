import { milestoneProgress } from "@/lib/milestone";

/** A milestone's completion bar: the share of its issues and pull requests that are closed. */
export function MilestoneProgress({
	openIssues,
	closedIssues,
}: {
	openIssues: number;
	closedIssues: number;
}) {
	const percent = milestoneProgress(openIssues, closedIssues);
	return (
		<div
			role="progressbar"
			aria-label="Milestone progress"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			className="h-2 w-full overflow-hidden rounded-full bg-bjork-field-inset"
		>
			<div
				className="h-full rounded-full bg-success"
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}
