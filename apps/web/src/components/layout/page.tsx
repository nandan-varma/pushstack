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
 * Main column plus a 296px aside on wide screens; the aside drops under the
 * main column on narrow ones (or above it with `asideFirst`).
 */
export function SplitLayout({
	main,
	aside,
	asideFirst = false,
	className,
}: {
	main: React.ReactNode;
	aside: React.ReactNode;
	asideFirst?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid gap-8 lg:grid-cols-[minmax(0,1fr)_296px] lg:items-start",
				className,
			)}
		>
			<div
				className={cn("min-w-0 space-y-4", asideFirst && "order-2 lg:order-1")}
			>
				{main}
			</div>
			<aside
				className={cn(
					"min-w-0 space-y-6 lg:sticky lg:top-20",
					asideFirst && "order-1 lg:order-2",
				)}
			>
				{aside}
			</aside>
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
				"border-b border-bjork-border-muted pb-6 last:border-0 last:pb-0",
				className,
			)}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
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
