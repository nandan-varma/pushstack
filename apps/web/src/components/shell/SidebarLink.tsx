import { createLink } from "@tanstack/react-router";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { useIconAnimation } from "@/components/animated-icon";
import { cn } from "@/lib/utils";

/**
 * One row of sidebar navigation: an icon that moves on hover/focus, the label,
 * and an optional count. The router marks the active row (`data-status`).
 */
function SidebarAnchor({
	icon: Icon,
	label,
	count,
	active,
	className,
	onMouseEnter,
	onMouseLeave,
	onFocus,
	onBlur,
	...props
}: ComponentProps<"a"> & {
	icon: ElementType;
	label: ReactNode;
	count?: number;
	/** Forces the active look when the route match is fuzzier than the link. */
	active?: boolean;
}) {
	const { ref, triggerProps } = useIconAnimation<HTMLAnchorElement>({
		onMouseEnter,
		onMouseLeave,
		onFocus,
		onBlur,
	});
	return (
		<a
			{...props}
			{...triggerProps}
			data-active={active || undefined}
			className={cn(
				"group/nav flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-bjork-text-muted transition-[background-color,color] duration-150 hover:bg-bjork-surface-hover hover:text-bjork-text",
				"data-[status=active]:bg-bjork-surface-active data-[status=active]:font-medium data-[status=active]:text-bjork-text data-[status=active]:shadow-(--bjork-shadow-soft)",
				"data-active:bg-bjork-surface-active data-active:font-medium data-active:text-bjork-text data-active:shadow-(--bjork-shadow-soft)",
				className,
			)}
		>
			<Icon
				ref={ref}
				size={16}
				aria-hidden="true"
				className="text-bjork-text-soft group-hover/nav:text-bjork-text group-data-[status=active]/nav:text-bjork-accent group-data-active/nav:text-bjork-accent"
			/>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{count !== undefined && count > 0 && (
				<span className="rounded-full bg-bjork-field-inset px-1.5 py-px font-mono text-[11px] text-bjork-text-medium tabular-nums">
					{count}
				</span>
			)}
		</a>
	);
}

export const SidebarLink = createLink(SidebarAnchor);

/** A small mono heading over a group of sidebar links. */
export function SidebarGroup({
	title,
	action,
	children,
}: {
	title?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="space-y-0.5">
			{title && (
				<div className="flex h-7 items-center justify-between px-2.5">
					<h2 className="font-mono text-[10px] font-medium tracking-[0.12em] text-bjork-text-soft uppercase">
						{title}
					</h2>
					{action}
				</div>
			)}
			{children}
		</div>
	);
}
