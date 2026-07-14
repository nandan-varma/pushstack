import type { ReactNode } from "react";

export function DetailHeader({
	title,
	badge,
	meta,
	actions,
}: {
	title: ReactNode;
	badge?: ReactNode;
	meta?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0 flex-1">
				<div className="mb-2 flex flex-wrap items-center gap-2.5">
					<h1 className="break-words text-2xl font-bold text-[var(--sea-ink)] sm:text-3xl">
						{title}
					</h1>
					{badge}
				</div>
				{meta}
			</div>
			{actions && (
				<div className="flex flex-wrap items-center gap-2">{actions}</div>
			)}
		</div>
	);
}
