import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BookMarked, GitBranch } from "lucide-react";
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
			className="island-shell feature-card group flex h-full min-w-0 flex-col rounded-[20px] p-5 no-underline"
		>
			<div className="flex min-w-0 items-start gap-3">
				<BookMarked
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<h3
							title={title}
							className="min-w-0 truncate text-base font-semibold tracking-tight text-foreground group-hover:text-primary"
						>
							{title}
						</h3>
						<VisibilityBadge visibility={repo.visibility} />
					</div>
					{repo.description && (
						<p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
							{repo.description}
						</p>
					)}
				</div>
				<ArrowUpRight
					className="mt-0.5 size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			</div>
			<div className="mt-auto flex items-center gap-3 pt-4 text-xs text-muted-foreground">
				<span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
					<GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">{repo.defaultBranch}</span>
				</span>
				<span className="shrink-0 whitespace-nowrap">
					Updated{" "}
					<time dateTime={new Date(repo.updatedAt).toISOString()}>
						{new Date(repo.updatedAt).toLocaleDateString()}
					</time>
				</span>
			</div>
		</Link>
	);
}
