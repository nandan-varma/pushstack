import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActivity } from "@/lib/activity";

interface Activity {
	id: number;
	type: string;
	metadata: unknown;
	createdAt: string | Date;
	repository?: { name: string; owner?: { username?: string } | null } | null;
}

export function ActivityFeed({
	activities,
	isLoading,
	isError,
	onRetry,
}: {
	activities?: Activity[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry?: () => void;
}) {
	if (isLoading) {
		return (
			<div className="space-y-2">
				{[1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-16" />
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<EmptyState
				variant="error"
				message="Couldn't load recent activity."
				action={
					onRetry && (
						<Button size="sm" variant="outline" onClick={onRetry}>
							Try again
						</Button>
					)
				}
			/>
		);
	}

	if (!activities || activities.length === 0) {
		return <EmptyState message="No recent activity yet." />;
	}

	return (
		<div className="space-y-2">
			{activities.map((activity) => {
				const { text, showRepo, linkTo, linkParams } =
					describeActivity(activity);
				const content = (
					<>
						<div className="text-xs font-medium text-[var(--sea-ink)]">
							{text}
							{showRepo && activity.repository && (
								<span className="ml-1 font-normal text-[var(--sea-ink-soft)]">
									in {activity.repository.owner?.username || "unknown"}/
									{activity.repository.name}
								</span>
							)}
						</div>
						<div className="mt-0.5 text-[10px] text-[var(--sea-ink-soft)]">
							{new Date(activity.createdAt).toLocaleString()}
						</div>
					</>
				);

				if (linkTo && linkParams) {
					return (
						<Link
							key={activity.id}
							to={linkTo}
							params={linkParams}
							className="block rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 no-underline transition hover:bg-[var(--surface-strong)]"
						>
							{content}
						</Link>
					);
				}

				return (
					<div
						key={activity.id}
						className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
					>
						{content}
					</div>
				);
			})}
		</div>
	);
}
