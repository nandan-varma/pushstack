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
		<div className="flex items-start justify-between gap-4">
			<div className="flex-1">
				<div className="flex items-center gap-3 mb-2">
					<h1 className="text-3xl font-bold text-[var(--sea-ink)]">{title}</h1>
					{badge}
				</div>
				{meta}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
