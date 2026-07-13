import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface FileDiff {
	path: string;
	status: string;
	patch: string;
}

export function FileDiffViewer({
	files,
	isLoading,
	emptyMessage,
	summaryExtra,
}: {
	files?: FileDiff[];
	isLoading?: boolean;
	emptyMessage?: string;
	summaryExtra?: ReactNode;
}) {
	if (isLoading) {
		return <Skeleton className="h-48" />;
	}

	if (!files || files.length === 0) {
		return (
			<p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
				{emptyMessage || "No changes to display."}
			</p>
		);
	}

	return (
		<div className="mt-4 space-y-4">
			{summaryExtra}
			{files.map((fileDiff) => (
				<div
					key={fileDiff.path}
					className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
				>
					<div className="mb-3 flex items-center justify-between">
						<code className="text-sm font-medium text-[var(--sea-ink)]">
							{fileDiff.path}
						</code>
						<span className="text-xs uppercase text-[var(--sea-ink-soft)]">
							{fileDiff.status}
						</span>
					</div>
					<pre className="overflow-x-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-[var(--chip-bg)] p-4 text-xs text-[var(--sea-ink)]">
						{fileDiff.patch}
					</pre>
				</div>
			))}
		</div>
	);
}
