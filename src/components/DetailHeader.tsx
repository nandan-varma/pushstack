import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function DetailHeaderSkeleton() {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0 flex-1 space-y-2.5">
				<div className="flex flex-wrap items-center gap-2.5">
					<div className="h-7 w-2/3 max-w-sm animate-pulse rounded-md bg-[var(--surface-raised)]" />
					<div className="h-5 w-14 shrink-0 animate-pulse rounded-full bg-[var(--surface-raised)]" />
				</div>
				<div className="h-4 w-1/2 max-w-xs animate-pulse rounded bg-[var(--surface-raised)]" />
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<div className="h-8 w-20 animate-pulse rounded-md bg-[var(--surface-raised)]" />
				<div className="h-8 w-16 animate-pulse rounded-md bg-[var(--surface-raised)]" />
			</div>
		</div>
	);
}

export function AvatarBodySkeleton() {
	return (
		<Card className="p-6">
			<div className="flex items-start gap-4">
				<div className="size-9 shrink-0 animate-pulse rounded-full bg-[var(--surface-raised)]" />
				<div className="min-w-0 flex-1 space-y-3">
					<div className="flex items-center gap-2">
						<div className="h-4 w-28 animate-pulse rounded bg-[var(--surface-raised)]" />
						<div className="h-3.5 w-20 animate-pulse rounded bg-[var(--surface-raised)]" />
					</div>
					<div className="space-y-2">
						<div className="h-3.5 w-full animate-pulse rounded bg-[var(--surface-raised)]" />
						<div className="h-3.5 w-5/6 animate-pulse rounded bg-[var(--surface-raised)]" />
						<div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--surface-raised)]" />
					</div>
				</div>
			</div>
		</Card>
	);
}

export function DetailHeader({
	title,
	badge,
	meta,
	actions,
}: {
	title: ReactNode;
	badge?: ReactNode;
	meta?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0 flex-1">
				<div className="mb-2 flex flex-wrap items-center gap-2.5">
					<h1 className="break-words text-2xl font-bold text-[var(--sea-ink)] sm:text-3xl">
						{title}
					</h1>
					{badge}
				</div>
				{meta}
			</div>
			{actions && (
				<div className="flex flex-wrap items-center gap-2">{actions}</div>
			)}
		</div>
	);
}
