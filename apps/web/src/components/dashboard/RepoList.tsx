import { EmptyState } from "@/components/EmptyState";
import {
	RepositoryCard,
	type RepositoryCardRepo,
} from "@/components/repo/RepositoryCard";
import { RepositoryListEmptyState } from "@/components/repo/RepositoryListEmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function RepoList({
	repos,
	isLoading,
	isError,
	onRetry,
}: {
	repos?: RepositoryCardRepo[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry?: () => void;
}) {
	if (isLoading) {
		return (
			<div className="space-y-4">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-32" />
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<EmptyState
				variant="error"
				message="Couldn't load your repositories."
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

	if (!repos || repos.length === 0) {
		return <RepositoryListEmptyState />;
	}

	return (
		<div className="space-y-4">
			{repos.map((repo) => (
				<RepositoryCard key={repo.id} repo={repo} />
			))}
		</div>
	);
}
