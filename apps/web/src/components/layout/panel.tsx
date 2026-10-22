import type * as React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The one content surface: a lit edge (border plus the surface shadow), radius
 * 18. Headers, bodies, rows and footers below share its 20px inset, so every
 * panel on every page lines up the same way.
 */
export function Panel({
	className,
	tone = "surface",
	...props
}: React.ComponentProps<"section"> & {
	/** `danger` tints the edge for destructive settings. */
	tone?: "surface" | "danger";
}) {
	return (
		<section
			data-slot="panel"
			className={cn(
				"overflow-hidden rounded-[18px] border bg-bjork-surface text-bjork-text shadow-(--bjork-shadow-surface)",
				tone === "danger"
					? "border-destructive/35"
					: "border-bjork-border-muted",
				className,
			)}
			{...props}
		/>
	);
}

/** A 48px bar: title on the left, actions on the right. */
export function PanelHeader({
	title,
	description,
	actions,
	className,
	children,
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
	children?: React.ReactNode;
}) {
	return (
		<header
			data-slot="panel-header"
			className={cn(
				"flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-bjork-border-muted bg-bjork-surface-muted px-5 py-2.5",
				className,
			)}
		>
			{children ?? (
				<div className="min-w-0">
					{title && (
						<h2 className="truncate text-sm font-semibold text-bjork-text-strong">
							{title}
						</h2>
					)}
					{description && (
						<p className="mt-0.5 text-[13px] text-bjork-text-muted">
							{description}
						</p>
					)}
				</div>
			)}
			{actions && (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			)}
		</header>
	);
}

export function PanelBody({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div data-slot="panel-body" className={cn("p-5", className)} {...props} />
	);
}

/** Actions under a form; right-aligned, on the recessed panel tone. */
export function PanelFooter({
	className,
	...props
}: React.ComponentProps<"footer">) {
	return (
		<footer
			data-slot="panel-footer"
			className={cn(
				"flex flex-wrap items-center justify-end gap-3 border-t border-bjork-border-muted bg-bjork-panel px-5 py-3",
				className,
			)}
			{...props}
		/>
	);
}

/** A list inside a panel; rows divide themselves. */
export function PanelList({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="panel-list"
			className={cn("divide-y divide-bjork-border-muted", className)}
			{...props}
		/>
	);
}

/** A list row. `interactive` rows light up on hover like the rest of the UI. */
export function PanelRow({
	className,
	interactive = false,
	...props
}: React.ComponentProps<"li"> & { interactive?: boolean }) {
	return (
		<li
			data-slot="panel-row"
			className={cn(
				"flex min-h-12 items-center gap-3 px-5 py-3",
				interactive &&
					"transition-[background-color] duration-150 hover:bg-bjork-surface-hover",
				className,
			)}
			{...props}
		/>
	);
}
