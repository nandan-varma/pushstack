import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	CircleDot,
	GitCommitHorizontal,
	GitPullRequest,
	Star,
	Terminal,
} from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { Skeleton } from "@/components/ui/skeleton";
import { DEMO_REPO, SITE_URL } from "@/lib/site";

import { useDemoRepository } from "./useDemoRepository";

const { owner, name } = DEMO_REPO;
const CLONE_URL = `${SITE_URL}/${owner}/${name}.git`;

export function LiveRepoPreview() {
	const { repo, repoFetched, branch, commits, commitsFetched } =
		useDemoRepository();

	return (
		<div className="overflow-hidden rounded-[20px] border border-bjork-border-muted bg-bjork-surface text-left shadow-(--bjork-shadow-surface)">
			<div className="flex h-16 items-center justify-between gap-3 border-b border-bjork-border-muted bg-bjork-surface-muted px-4 sm:px-5">
				<Link
					to="/$owner/$name"
					params={{ owner, name }}
					className="flex min-w-0 items-center gap-2 text-sm font-medium text-bjork-text no-underline hover:underline"
				>
					<span className="relative flex size-2 shrink-0">
						<span className="absolute inline-flex size-full rounded-full bg-bjork-text-soft opacity-60" />
						<span
							className={`relative inline-flex size-2 rounded-full ${commits ? "bg-success" : "bg-bjork-text-soft"}`}
						/>
					</span>
					<span className="truncate">
						{owner} / {name}
					</span>
					<span className="hidden rounded-full border border-bjork-border bg-bjork-field-inset px-2 py-0.5 text-[11px] font-medium text-bjork-text-soft sm:inline">
						{commits ? "Live" : repoFetched ? "Preview" : "Loading"}
					</span>
				</Link>
				<div className="flex shrink-0 items-center gap-2 text-xs text-bjork-text-soft">
					{repo && (
						<span className="hidden items-center gap-1.5 tabular-nums sm:flex">
							<Star aria-hidden="true" className="size-3.5" /> {repo.starCount}
							<span className="sr-only">stars</span>
						</span>
					)}
					<span className="rounded-md border border-bjork-border bg-bjork-field-inset px-2 py-1 font-mono text-[11px]">
						{branch}
					</span>
				</div>
			</div>
			<div className="grid grid-cols-1">
				<div className="border-b border-bjork-border-muted p-5 sm:p-7">
					<p className="text-xs font-semibold tracking-[0.14em] text-bjork-text-soft uppercase">
						Latest commits
					</p>
					{/* Hover preloads share these queries; keep their retries from shifting the page. */}
					<div className="mt-4 min-h-[342px] space-y-2">
						{commits?.length ? (
							commits.map((commit) => (
								<Link
									key={commit.sha}
									to="/$owner/$name/commit/$sha"
									params={{ owner, name, sha: commit.sha }}
									className="flex h-[62px] items-center gap-3 rounded-[12px] bg-bjork-field-inset p-3 no-underline transition-colors hover:bg-bjork-surface-hover"
								>
									<GitCommitHorizontal className="size-4 shrink-0 text-bjork-text-soft" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-bjork-text">
											{commit.message.split("\n")[0]}
										</p>
										<p className="mt-0.5 text-xs text-bjork-text-soft">
											{commit.authorName} ·{" "}
											<RelativeTime date={commit.createdAt} />
										</p>
									</div>
									<code className="hidden shrink-0 font-mono text-[11px] text-bjork-text-soft sm:block">
										{commit.sha.substring(0, 7)}
									</code>
								</Link>
							))
						) : commits ? (
							<p className="text-sm text-bjork-text-soft">No commits yet.</p>
						) : repoFetched && !repo ? (
							<p className="text-sm text-bjork-text-soft">
								{repo === null
									? "This repository isn't available."
									: "Couldn't load commits right now."}
							</p>
						) : commitsFetched ? (
							<p className="text-sm text-bjork-text-soft">
								Couldn't load commits right now.
							</p>
						) : (
							[1, 2, 3, 4, 5].map((i) => (
								<Skeleton key={i} className="h-[62px] rounded-lg" />
							))
						)}
					</div>
					<div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
						<Link
							to="/$owner/$name"
							params={{ owner, name }}
							className="inline-flex items-center gap-1 font-medium text-bjork-text"
						>
							Browse the code <ArrowRight className="size-3.5" />
						</Link>
						<Link
							to="/$owner/$name/issues"
							params={{ owner, name }}
							className="inline-flex items-center gap-1 text-bjork-text-soft hover:text-bjork-text"
						>
							<CircleDot className="size-3.5" /> Issues
						</Link>
						<Link
							to="/$owner/$name/pulls"
							params={{ owner, name }}
							className="inline-flex items-center gap-1 text-bjork-text-soft hover:text-bjork-text"
						>
							<GitPullRequest className="size-3.5" /> Pull requests
						</Link>
					</div>
				</div>
				<div className="bg-background/50 p-5 font-mono text-xs leading-6 text-bjork-text sm:p-7">
					<div className="mb-5 flex items-center gap-2 text-bjork-text-soft">
						<Terminal className="size-4" /> Try a public repository
					</div>
					<p className="break-all">
						<span className="text-primary">$</span> git clone {CLONE_URL}
					</p>
					<p className="mt-5 text-bjork-text-soft">
						# use the GitHub CLI with PushStack
					</p>
					<p className="break-all">
						<span className="text-primary">$</span> gh auth login --hostname{" "}
						{new URL(SITE_URL).hostname}
					</p>
					<p className="mt-3 break-all">
						<span className="text-primary">$</span> gh repo view{" "}
						{new URL(SITE_URL).hostname}/{owner}/{name}
					</p>
				</div>
			</div>
		</div>
	);
}
