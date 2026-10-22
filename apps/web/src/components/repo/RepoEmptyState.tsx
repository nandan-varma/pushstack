import { PushGuide } from "@/components/repo/PushGuide";

/** A repository nobody has pushed to: the way in, as steps. */
export function RepoEmptyState({
	owner,
	name,
	branch,
	canWrite,
}: {
	owner: string;
	name: string;
	branch: string;
	canWrite: boolean;
}) {
	return (
		<div className="max-w-[760px] space-y-4">
			<div>
				<h1 className="text-[22px] font-semibold tracking-[-0.025em] text-bjork-text">
					This repository is empty
				</h1>
				<p className="mt-1 text-sm text-bjork-text-muted">
					Push some code and it will show up here.
				</p>
			</div>
			<PushGuide
				owner={owner}
				name={name}
				branch={branch}
				canWrite={canWrite}
			/>
		</div>
	);
}
