import type { ReactNode } from "react";

interface PageHeaderProps {
	title: ReactNode;
	description?: string;
	eyebrow?: string;
	actions?: ReactNode;
	/** Compact is the in-repository scale; full pages use the default. */
	size?: "default" | "compact";
}

/** A consistent title and action landmark for workspace pages. */
export function PageHeader({
	title,
	description,
	eyebrow,
	actions,
	size = "default",
}: PageHeaderProps) {
	const compact = size === "compact";
	return (
		<header
			className={
				compact
					? "mb-4 flex flex-wrap items-center justify-between gap-3"
					: "mb-6 flex flex-wrap items-center justify-between gap-4"
			}
		>
			<div className="min-w-0">
				{eyebrow && (
					<p className={compact ? "island-kicker mb-2" : "island-kicker mb-3"}>
						{eyebrow}
					</p>
				)}
				<h1
					className={
						compact
							? "text-xl font-semibold tracking-tight text-foreground"
							: "text-3xl font-semibold tracking-tight text-foreground"
					}
				>
					{title}
				</h1>
				{description && (
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						{description}
					</p>
				)}
			</div>
			{actions && (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			)}
		</header>
	);
}
