import type { ReactNode } from "react";

/**
 * The shared failure surface for route error components. Raw driver/storage
 * errors (an S3 XML body, a database message) are useful for a developer but
 * noise for everyone else, so the page leads with a plain-language title and
 * folds the original message into a disclosure.
 */
export function ErrorPanel({
	title,
	description,
	detail,
	actions,
}: {
	title: string;
	description?: string;
	detail?: string;
	actions?: ReactNode;
}) {
	const trimmed = detail?.trim();
	return (
		<div className="island-shell mx-auto max-w-xl rounded-[20px] px-5 py-7 text-center sm:px-8">
			<h1 className="mb-2 text-lg font-semibold text-foreground">{title}</h1>
			{description && (
				<p className="mx-auto mb-5 max-w-md text-sm leading-6 text-muted-foreground">
					{description}
				</p>
			)}
			{actions && (
				<div className="flex flex-wrap items-center justify-center gap-2">
					{actions}
				</div>
			)}
			{trimmed && (
				<details className="mt-5 text-left">
					<summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
						Technical details
					</summary>
					<pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-muted-foreground">
						{trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed}
					</pre>
				</details>
			)}
		</div>
	);
}
