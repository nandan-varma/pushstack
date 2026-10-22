import { useQuery } from "@tanstack/react-query";
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
import {
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";
import { DEMO_REPO, SITE_URL } from "@/lib/site";

const { owner, name } = DEMO_REPO;
const CLONE_URL = `${SITE_URL}/${owner}/${name}.git`;

export function LiveRepoPreview() {
	const { data: repo, isError: repoMissing } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const branch = repo?.defaultBranch ?? "main";
	const { data: commits, isError: commitsFailed } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			limit: 5,
		}),
		enabled: !!repo,
	});

	return (
		<div className="overflow-hidden rounded-[20px] border border-bjork-border-muted bg-bjork-surface text-left shadow-(--bjork-shadow-surface)">
			<div className="flex h-16 items-center justify-between gap-3 border-b border-bjork-border-muted bg-bjork-surface-muted px-4 sm:px-5">
				<Link
					to="/$owner/$name"
					params={{ owner, name }}
					className="flex min-w-0 items-center gap-2 text-sm font-medium text-bjork-text no-underline hover:underline"
				>
					<span className="relative flex size-2 shrink-0">
						<span className="absolute inline-flex size-full rounded-full bg-success opacity-60" />
						<span className="relative inline-flex size-2 rounded-full bg-success" />
					</span>
					<span className="truncate">
						{owner} / {name}
					</span>
					<span className="hidden rounded-full border border-bjork-border bg-bjork-field-inset px-2 py-0.5 text-[11px] font-medium text-bjork-text-soft sm:inline">
						Live
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
			<div className="grid ">
				<div className="border-b border-bjork-border-muted p-5 sm:p-7 lg:border-r lg:border-b-0">
					<p className="text-xs font-semibold tracking-[0.14em] text-bjork-text-soft uppercase">
						Latest commits
					</p>
					<div className="mt-4 space-y-2">
						{commits ? (
							commits.map((commit) => (
								<Link
									key={commit.sha}
									to="/$owner/$name/commit/$sha"
									params={{ owner, name, sha: commit.sha }}
									className="flex items-center gap-3 rounded-[12px] bg-bjork-field-inset p-3 no-underline transition-colors hover:bg-bjork-surface-hover"
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
						) : repoMissing || commitsFailed ? (
							<p className="text-sm text-bjork-text-soft">
								Couldn't load commits right now.
							</p>
						) : (
							[1, 2, 3, 4, 5].map((i) => (
								<Skeleton key={i} className="h-[54px] rounded-lg" />
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
						<Terminal className="size-4" /> Try it — no account needed
					</div>
					<p className="break-all">
						<span className="text-primary">$</span> git clone {CLONE_URL}
					</p>
					<p className="mt-3 text-bjork-text-soft">Cloning into '{name}'...</p>
					<p className="text-bjork-text-soft">Receiving objects: 100%, done.</p>
					<p className="mt-5 text-bjork-text-soft"># then, with an account:</p>
					<p className="break-all">
						<span className="text-primary">$</span> git remote add pushstack{" "}
						{SITE_URL}/you/repo.git
					</p>
					<p>
						<span className="text-primary">$</span> git push pushstack main
					</p>
					<p className="mt-3 text-primary">✓ main updated · review ready</p>
					<p className="mt-4">
						<span className="text-primary">$</span>{" "}
						<span className="text-primary">_</span>
					</p>
				</div>
			</div>
		</div>
	);
}
