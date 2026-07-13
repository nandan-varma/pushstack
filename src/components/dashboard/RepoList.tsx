import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
			<div className="island-shell rounded-xl p-12 text-center">
				<p className="mb-4 text-sm text-red-600 dark:text-red-400">
					Couldn't load your repositories.
				</p>
				{onRetry && (
					<Button size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				)}
			</div>
		);
	}

	if (!repos || repos.length === 0) {
		return (
			<div className="island-shell rounded-xl p-12 text-center">
				<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
					No repositories yet.
				</p>
				<Link to="/repositories/new">
					<Button size="sm">Create your first repository</Button>
				</Link>
			</div>
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
									<span
										className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
											repo.visibility === "public"
												? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
												: "border-[var(--line)] text-[var(--sea-ink-soft)]"
										}`}
									>
										{repo.visibility}
									</span>
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
