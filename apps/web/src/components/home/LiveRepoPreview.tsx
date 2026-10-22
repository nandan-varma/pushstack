import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
	ArrowRight,
	CircleDot,
	GitCommitHorizontal,
	GitPullRequest,
	Star,
	Terminal,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";
import { DEMO_REPO, SITE_URL } from "@/lib/site";

const { owner, name } = DEMO_REPO;
const CLONE_URL = `${SITE_URL}/api/git/${owner}/${name}.git`;

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
		<div className="island-shell overflow-hidden rounded-[24px] text-left">
			<div className="flex h-16 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 sm:px-5">
				<Link
					to="/$owner/$name"
					params={{ owner, name }}
					className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground no-underline hover:underline"
				>
					<span className="relative flex size-2 shrink-0">
						<span className="absolute inline-flex size-full rounded-full bg-success opacity-60" />
						<span className="relative inline-flex size-2 rounded-full bg-success" />
					</span>
					<span className="truncate">
						{owner} / {name}
					</span>
					<span className="hidden rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">
						Live
					</span>
				</Link>
				<div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
					{repo && (
						<span className="hidden items-center gap-1.5 tabular-nums sm:flex">
							<Star aria-hidden="true" className="size-3.5" /> {repo.starCount}
							<span className="sr-only">stars</span>
						</span>
					)}
					<span className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]">
						{branch}
					</span>
				</div>
			</div>
			<div className="grid lg:grid-cols-[1fr_1.12fr]">
				<div className="border-b border-border p-5 sm:p-7 lg:border-r lg:border-b-0">
					<p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
						Latest commits
					</p>
					<div className="mt-4 space-y-2">
						{commits ? (
							commits.map((commit) => (
								<Link
									key={commit.sha}
									to="/$owner/$name/commit/$sha"
									params={{ owner, name, sha: commit.sha }}
									className="flex items-center gap-3 rounded-[12px] bg-background/40 p-3 no-underline transition-colors hover:bg-muted/60"
								>
									<GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-foreground">
											{commit.message.split("\n")[0]}
										</p>
										<p className="mt-0.5 text-xs text-muted-foreground">
											{commit.authorName} ·{" "}
											{formatDistanceToNow(new Date(commit.createdAt), {
												addSuffix: true,
											})}
										</p>
									</div>
									<code className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:block">
										{commit.sha.substring(0, 7)}
									</code>
								</Link>
							))
						) : repoMissing || commitsFailed ? (
							<p className="text-sm text-muted-foreground">
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
							className="inline-flex items-center gap-1 font-medium text-foreground"
						>
							Browse the code <ArrowRight className="size-3.5" />
						</Link>
						<Link
							to="/$owner/$name/issues"
							params={{ owner, name }}
							className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
						>
							<CircleDot className="size-3.5" /> Issues
						</Link>
						<Link
							to="/$owner/$name/pulls"
							params={{ owner, name }}
							className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
						>
							<GitPullRequest className="size-3.5" /> Pull requests
						</Link>
					</div>
				</div>
				<div className="bg-background/50 p-5 font-mono text-xs leading-6 text-foreground sm:p-7">
					<div className="mb-5 flex items-center gap-2 text-muted-foreground">
						<Terminal className="size-4" /> Try it — no account needed
					</div>
					<p className="break-all">
						<span className="text-primary">$</span> git clone {CLONE_URL}
					</p>
					<p className="mt-3 text-muted-foreground">Cloning into '{name}'...</p>
					<p className="text-muted-foreground">
						Receiving objects: 100%, done.
					</p>
					<p className="mt-5 text-muted-foreground"># then, with an account:</p>
					<p className="break-all">
						<span className="text-primary">$</span> git remote add pushstack{" "}
						{SITE_URL}/api/git/you/repo.git
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
