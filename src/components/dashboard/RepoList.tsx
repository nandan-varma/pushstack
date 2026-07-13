import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@/components/ui/visibility-badge";

interface Repo {
	id: number;
	name: string;
	description: string | null;
	visibility: string;
	defaultBranch: string | null;
	updatedAt: string | Date;
	owner?: { username?: string | null } | null;
}

export function RepoList({
	repos,
	isLoading,
	isError,
	onRetry,
}: {
	repos?: Repo[];
	isLoading?: boolean;
	isError?: boolean;
	onRetry?: () => void;
}) {
	if (isLoading) {
		return (
			<div className="space-y-3">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-24" />
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
						<Button size="sm" variant="outline" onClick={onRetry}>
							Try again
						</Button>
					)
				}
			/>
		);
	}

	if (!repos || repos.length === 0) {
		return (
			<EmptyState
				message="No repositories yet."
				action={
					<Link to="/repositories/new">
						<Button size="sm">Create your first repository</Button>
					</Link>
				}
			/>
		);
	}

	return (
		<div className="space-y-3">
			{repos.map((repo) => {
				const ownerUsername = repo.owner?.username || "unknown";
				return (
					<Link
						key={repo.id}
						to="/repo/$owner/$name/tree/$branch/$"
						params={{
							owner: ownerUsername,
							name: repo.name,
							branch: repo.defaultBranch || "main",
							_splat: "",
						}}
						className="island-shell feature-card block rounded-xl p-5 no-underline"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<h3
										title={`${ownerUsername}/${repo.name}`}
										className="truncate text-sm font-semibold text-[var(--lagoon-deep)]"
									>
										{ownerUsername}/{repo.name}
									</h3>
									<VisibilityBadge visibility={repo.visibility} />
								</div>
								{repo.description && (
									<p className="mt-1 line-clamp-1 text-xs text-[var(--sea-ink-soft)]">
										{repo.description}
									</p>
								)}
							</div>
							<span className="shrink-0 text-xs text-[var(--sea-ink-soft)]">
								{new Date(repo.updatedAt).toLocaleDateString()}
							</span>
						</div>
					</Link>
				);
			})}
		</div>
	);
}
