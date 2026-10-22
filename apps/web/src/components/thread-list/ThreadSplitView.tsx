import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Issues and pull requests as an inbox: with a thread open, the list stays
 * beside it on wide screens so triage never round-trips through the list.
 * Narrower screens (and `wide` details such as a diff) show the thread alone.
 */
export function ThreadSplitView({
	list,
	detail,
	wide = false,
}: {
	list: ReactNode;
	/** The open thread, or nothing for the list alone. */
	detail?: ReactNode;
	wide?: boolean;
}) {
	if (!detail) return <div className="space-y-4">{list}</div>;
	return (
		<div
			className={cn(
				!wide &&
					"xl:grid xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start xl:gap-6",
			)}
		>
			<div
				className={cn(
					"hidden",
					!wide &&
						"xl:sticky xl:top-6 xl:block xl:max-h-[calc(100vh-3rem)] xl:space-y-3 xl:overflow-y-auto xl:overscroll-contain xl:pb-1",
				)}
			>
				{list}
			</div>
			<div className="min-w-0">{detail}</div>
		</div>
	);
}
