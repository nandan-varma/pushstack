import type { ReactNode } from "react";
import { Panel } from "@/components/layout/panel";
import { Skeleton } from "@/components/ui/skeleton";

export function DetailHeaderSkeleton() {
	return (
		<div className="mb-6 space-y-3 border-b border-bjork-border-muted pb-5">
			<Skeleton className="h-8 w-2/3 max-w-lg" />
			<div className="flex items-center gap-3">
				<Skeleton className="h-8 w-20 rounded-full" />
				<Skeleton className="h-4 w-64" />
			</div>
		</div>
	);
}

export function AvatarBodySkeleton() {
	return (
		<Panel className="p-5">
			<div className="flex items-start gap-4">
				<Skeleton className="size-9 shrink-0 rounded-full" />
				<div className="min-w-0 flex-1 space-y-3">
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-3.5 w-full" />
					<Skeleton className="h-3.5 w-5/6" />
					<Skeleton className="h-3.5 w-2/3" />
				</div>
			</div>
		</Panel>
	);
}

/**
 * An issue or pull request's header: the title with its number, then the
 * state pill and one line of who/when, ruled off from the conversation.
 */
export function DetailHeader({
	title,
	number,
	badge,
	meta,
	actions,
}: {
	title: ReactNode;
	number?: number;
	badge?: ReactNode;
	meta?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="mb-6 border-b border-bjork-border-muted pb-5">
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<h1 className="min-w-0 flex-1 basis-96 text-2xl font-semibold tracking-[-0.025em] break-words text-bjork-text sm:text-[28px] sm:leading-9">
					{title}
					{number !== undefined && (
						<span className="ml-2 font-normal text-bjork-text-soft">
							#{number}
						</span>
					)}
				</h1>
				{actions && (
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						{actions}
					</div>
				)}
			</div>
			{(badge || meta) && (
				<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-bjork-text-muted">
					{badge}
					{meta}
				</div>
			)}
		</header>
	);
}
