import type * as React from "react";
import { cn } from "#/lib/utils.ts";

const widths = {
	/** Workspaces: repositories, lists, dashboards. */
	default: "max-w-[1280px]",
	/** Reading and single forms: auth, a thread, a settings page. */
	narrow: "max-w-[880px]",
} as const;

/**
 * Every top-level page. One width, one gutter and one vertical rhythm, so
 * page edges never move as you navigate.
 */
export function Page({
	className,
	width = "default",
	...props
}: React.ComponentProps<"div"> & { width?: keyof typeof widths }) {
	return (
		<div
			className={cn(
				"mx-auto w-full px-4 py-8 sm:px-6 sm:py-10",
				widths[width],
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Main column plus a 280px aside. It responds to its own width, not the
 * viewport's, so it works in a full page and in a split view's detail pane
 * alike: narrow, the aside becomes a compact strip above the main column.
 */
export function SplitLayout({
	main,
	aside,
	className,
}: {
	main: React.ReactNode;
	/** Omit while loading so no empty aside surface flashes in. */
	aside?: React.ReactNode;
	className?: string;
}) {
	if (!aside) {
		return <div className={cn("min-w-0 space-y-4", className)}>{main}</div>;
	}
	return (
		<div className={cn("@container", className)}>
			<div className="grid grid-cols-[minmax(0,1fr)] gap-5 @4xl:grid-cols-[minmax(0,1fr)_280px] @4xl:items-start @4xl:gap-8">
				<aside className="order-last grid min-w-0 gap-x-6 gap-y-4 rounded-[18px] border border-bjork-border-muted bg-bjork-surface p-4 @lg:grid-cols-3 @4xl:sticky @4xl:top-6 @4xl:block @4xl:space-y-5 @4xl:border-0 @4xl:bg-transparent @4xl:p-0">
					{aside}
				</aside>
				<div className="min-w-0 space-y-4">{main}</div>
			</div>
		</div>
	);
}

/** A labelled group in an aside: a small mono label, then its content. */
export function AsideSection({
	title,
	action,
	children,
	className,
}: {
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"min-w-0 @4xl:border-b @4xl:border-bjork-border-muted @4xl:pb-5 @4xl:last:border-0 @4xl:last:pb-0",
				className,
			)}
		>
			<div className="mb-2 flex min-h-6 items-center justify-between gap-2">
				<h2 className="font-mono text-[10px] font-medium tracking-[0.12em] text-bjork-text-soft uppercase">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/** Controls above a panel: primary controls left, secondary right. */
export function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-3",
				className,
			)}
			{...props}
		/>
	);
}
