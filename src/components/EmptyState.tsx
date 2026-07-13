import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

export function EmptyState({
	message,
	action,
	variant = "default",
}: {
	message: string;
	action?: ReactNode;
	variant?: "default" | "error";
}) {
	return (
		<div className="island-shell rounded-xl p-12 text-center">
			<p
				className={cn(
					"mb-4 text-sm",
					variant === "error"
						? "text-red-600 dark:text-red-400"
						: "text-[var(--sea-ink-soft)]",
				)}
			>
				{message}
			</p>
			{action}
		</div>
	);
}
