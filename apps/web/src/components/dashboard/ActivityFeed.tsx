import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ActivityRow, describeActivity } from "@/lib/activity";

export function ActivityFeed({
	activities,
	isLoading,
	isError,
	onRetry,
}: {
	activities?: ActivityRow[];
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
				const { text, link } = describeActivity(activity);
				const content = (
					<>
						<div className="text-xs font-medium text-foreground">
							{text}
							{activity.repository && (
								<span className="ml-1 font-normal text-muted-foreground">
									in {activity.repository.owner.username}/
									{activity.repository.name}
								</span>
							)}
						</div>
						<div className="mt-0.5 text-[10px] text-muted-foreground">
							{new Date(activity.createdAt).toLocaleString()}
						</div>
					</>
				);

				if (link) {
					return (
						<Link
							key={activity.id}
							to={link.to}
							params={link.params}
							className="block rounded-lg border border-border bg-background p-3 no-underline transition hover:bg-card"
						>
							{content}
						</Link>
					);
				}

				return (
					<div
						key={activity.id}
						className="rounded-lg border border-border bg-background p-3"
					>
						{content}
					</div>
				);
			})}
		</div>
	);
}
