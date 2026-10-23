import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { AsideSection } from "@/components/layout/page";
import { MilestoneProgress } from "@/components/milestone/MilestoneProgress";
import { buttonVariants } from "@/components/ui/button";

const ThreadMilestonePicker = lazy(
	() => import("@/components/ThreadMilestonePicker"),
);

export interface ThreadMilestoneView {
	number: number;
	title: string;
	openIssues: number;
	closedIssues: number;
}

/** The milestone of an issue or pull request, with a picker for people who can triage. */
export function ThreadMilestone({
	owner,
	name,
	repoId,
	number,
	milestone,
	canEdit,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	milestone: ThreadMilestoneView | null;
	canEdit: boolean;
}) {
	return (
		<AsideSection
			title="Milestone"
			action={
				canEdit && (
					<Suspense
						fallback={
							<span
								className={buttonVariants({
									variant: "ghost",
									size: "icon-xs",
								})}
							>
								<Settings2 aria-hidden="true" />
							</span>
						}
					>
						<ThreadMilestonePicker
							owner={owner}
							name={name}
							repoId={repoId}
							number={number}
							current={milestone?.number ?? null}
						/>
					</Suspense>
				)
			}
		>
			{milestone ? (
				<div className="space-y-2">
					<MilestoneProgress
						openIssues={milestone.openIssues}
						closedIssues={milestone.closedIssues}
					/>
					<Link
						to="/$owner/$name/milestone/$number"
						params={{ owner, name, number: String(milestone.number) }}
						className="text-sm font-medium text-bjork-text hover:text-bjork-accent"
					>
						{milestone.title}
					</Link>
				</div>
			) : (
				<p className="text-sm text-bjork-text-soft">No milestone</p>
			)}
		</AsideSection>
	);
}
