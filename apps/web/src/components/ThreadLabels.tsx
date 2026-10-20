import { Tag } from "lucide-react";
import { lazy, Suspense } from "react";
import { LabelChip } from "@/components/LabelChip";
import { Button } from "@/components/ui/button";
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
	if (!canEdit && labels.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{labels.map((label) => (
				<LabelChip key={label.id} {...label} />
			))}
			{canEdit && (
				<Suspense
					fallback={
						<Button size="sm" variant="outline" disabled>
							<Tag className="size-3.5" />
							Labels
						</Button>
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
			)}
		</div>
	);
}
