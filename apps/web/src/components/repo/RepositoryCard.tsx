import { Link } from "@tanstack/react-router";
import { VisibilityBadge } from "@/components/ui/visibility-badge";

export interface RepositoryCardRepo {
	id: number;
	name: string;
	description: string | null;
	visibility: string;
	defaultBranch: string;
	updatedAt: string | Date;
	owner: { username: string };
}

/**
 * The repository card shared by the dashboard, `/repositories`, search and
 * profile pages. GitHub titles list cards `owner/name` and a profile's cards
 * `name` (its owner is the page subject), so `showOwner` picks the mode rather
 * than forking the markup. An empty description renders nothing, as on GitHub.
 */
export function RepositoryCard({
	repo,
	showOwner = true,
}: {
	repo: RepositoryCardRepo;
	showOwner?: boolean;
}) {
	const owner = repo.owner.username;
	const title = showOwner ? `${owner}/${repo.name}` : repo.name;

	return (
		<Link
			to="/$owner/$name/tree/$branch/$"
			params={{
				owner,
				name: repo.name,
				branch: repo.defaultBranch,
				_splat: "",
			}}
			className="island-shell feature-card block rounded-xl p-5 no-underline"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3
							title={title}
							className="truncate text-sm font-semibold text-primary"
						>
							{title}
						</h3>
						<VisibilityBadge visibility={repo.visibility} />
					</div>
					{repo.description && (
						<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
							{repo.description}
						</p>
					)}
				</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					{new Date(repo.updatedAt).toLocaleDateString()}
				</span>
			</div>
		</Link>
	);
}
