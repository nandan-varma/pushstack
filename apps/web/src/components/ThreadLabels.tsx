import { Settings2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { LabelChip } from "@/components/LabelChip";
import { AsideSection } from "@/components/layout/page";
import { buttonVariants } from "@/components/ui/button";
import type { LabelView } from "@/lib/labels";

const ThreadLabelPicker = lazy(() => import("@/components/ThreadLabelPicker"));

export function ThreadLabels({
	owner,
	name,
	repoId,
	number,
	labels,
	canEdit,
}: {
	owner: string;
	name: string;
	repoId: number;
	number: number;
	labels: LabelView[];
	canEdit: boolean;
}) {
	return (
		<AsideSection
			title="Labels"
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
						<ThreadLabelPicker
							owner={owner}
							name={name}
							repoId={repoId}
							number={number}
							labels={labels}
						/>
					</Suspense>
				)
			}
		>
			{labels.length === 0 ? (
				<p className="text-sm text-bjork-text-soft">None yet</p>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{labels.map((label) => (
						<LabelChip key={label.id} {...label} />
					))}
				</div>
			)}
		</AsideSection>
	);
}
