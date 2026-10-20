import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/** An inline validation or request error under a form field or section. */
export function FieldError({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	if (!children) return null;
	return (
		<p className={cn("text-sm text-red-600 dark:text-red-400", className)}>
			{children}
		</p>
	);
}
