import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * What a list or page shows with nothing in it: an optional icon and title,
 * one sentence, and the action that fixes it. `bare` drops the surface for
 * use inside a panel that already has one.
 */
export function EmptyState({
	icon,
	title,
	message,
	action,
	variant = "default",
	bare = false,
}: {
	icon?: ReactNode;
	title?: string;
	message: string;
	action?: ReactNode;
	variant?: "default" | "error";
	bare?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center px-6 py-14 text-center",
				!bare &&
					"rounded-[18px] border border-bjork-border-muted bg-bjork-surface shadow-(--bjork-shadow-surface)",
			)}
		>
			{icon && (
				<div className="mb-4 flex size-11 items-center justify-center rounded-[13px] border border-bjork-border bg-bjork-field-inset text-bjork-text-soft shadow-(--bjork-shadow-inset) [&_svg]:size-5">
					{icon}
				</div>
			)}
			{title && (
				<h3 className="mb-1.5 text-base font-semibold text-bjork-text-strong">
					{title}
				</h3>
			)}
			<p
				className={cn(
					"max-w-md text-sm leading-6",
					variant === "error" ? "text-destructive" : "text-bjork-text-muted",
				)}
			>
				{message}
			</p>
			{action && (
				<div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>
			)}
		</div>
	);
}
