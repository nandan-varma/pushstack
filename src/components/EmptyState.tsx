import type { ReactNode } from "react";

export function EmptyState({
	message,
	action,
}: {
	message: string;
	action?: ReactNode;
}) {
	return (
		<div className="island-shell rounded-xl p-12 text-center">
			<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{message}</p>
			{action}
		</div>
	);
}
