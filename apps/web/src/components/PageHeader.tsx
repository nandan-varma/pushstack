import type { ReactNode } from "react";

/**
 * The title row of an app page: the title (with an optional count or short
 * fact beside it), an optional sentence under it, and the page's actions.
 */
export function PageHeader({
	title,
	meta,
	description,
	actions,
}: {
	title: ReactNode;
	/** A count or short fact set beside the title, e.g. "12". */
	meta?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
			<div className="min-w-0">
				<h1 className="flex items-baseline gap-2 text-[22px] font-semibold tracking-[-0.025em] text-bjork-text">
					{title}
					{meta !== undefined && (
						<span className="font-mono text-sm font-normal text-bjork-text-soft tabular-nums">
							{meta}
						</span>
					)}
				</h1>
				{description && (
					<p className="mt-1 text-sm text-bjork-text-muted">{description}</p>
				)}
			</div>
			{actions && (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			)}
		</header>
	);
}
