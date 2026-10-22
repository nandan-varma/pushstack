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
		<div className="island-shell rounded-[20px] px-6 py-12 text-center">
			<p
				className={cn(
					"mx-auto mb-5 max-w-md text-sm leading-relaxed",
					variant === "error" ? "text-destructive" : "text-muted-foreground",
				)}
			>
				{message}
			</p>
			{action}
		</div>
	);
}
