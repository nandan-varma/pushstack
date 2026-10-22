import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

export function FieldError({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	if (!children) return null;
	return (
		<p className={cn("text-sm text-destructive", className)}>{children}</p>
	);
}
