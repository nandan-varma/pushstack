import type * as React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
	variant?: "default" | "success" | "warning" | "danger" | "info";
}

export function Badge({
	className = "",
	variant = "default",
	...props
}: BadgeProps) {
	const variantStyles = {
		default:
			"bg-[var(--chip-bg)] text-[var(--sea-ink)] border-[var(--chip-line)]",
		success:
			"bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
		warning:
			"bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
		danger:
			"bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
		info: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
	};

	return (
		<div
			className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variantStyles[variant]} ${className}`}
			{...props}
		/>
	);
}
