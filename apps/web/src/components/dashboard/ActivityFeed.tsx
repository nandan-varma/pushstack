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
			<div className="space-y-4">
				{[1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-14" />
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
						<Button variant="outline" onClick={onRetry}>
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
		<ul className="island-shell divide-y divide-border overflow-hidden rounded-[20px]">
			{activities.map((activity) => {
				const { text, link } = describeActivity(activity);
				const content = (
					<>
						<div className="text-sm text-foreground">
							{text}
							{activity.repository && (
								<span className="ml-1 text-muted-foreground">
									in {activity.repository.owner.username}/
									{activity.repository.name}
								</span>
							)}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{new Date(activity.createdAt).toLocaleString()}
						</div>
					</>
				);

				return (
					<li key={activity.id}>
						{link ? (
							<Link
								to={link.to}
								params={link.params}
								className="block px-4 py-3.5 no-underline transition-colors hover:bg-muted/50"
							>
								{content}
							</Link>
						) : (
							<div className="px-4 py-3.5">{content}</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
