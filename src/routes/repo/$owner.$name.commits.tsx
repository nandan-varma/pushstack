import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";

export const Route = createFileRoute("/repo/$owner/$name/commits")({
	validateSearch: (search: Record<string, unknown>) => ({
		branch: (search.branch as string) || "main",
	}),
	loaderDeps: ({ search }) => ({ branch: search.branch }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await Promise.all([
				queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
				queryClient.ensureQueryData(
					repositoryCommitsQueryOptions({
						repoId: repo.id,
						branchName: deps.branch,
					}),
				),
			]);
		}
	},
	component: CommitsPage,
});

const getInitials = (n: string) =>
	n
		.split(" ")
		.map((p) => p[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

function CommitsPage() {
	const { owner, name } = Route.useParams();
	const { branch } = Route.useSearch();
	const navigate = useNavigate();

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: commits, isLoading } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
		}),
		enabled: !!repo,
	});

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	return (
		<div className="space-y-5">
			{/* Toolbar */}
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<select
						value={branch}
						onChange={(e) =>
							navigate({
								to: "/repo/$owner/$name/commits",
								params: { owner, name },
								search: { branch: e.target.value },
							})
						}
						className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]/30"
					>
						{branches?.map((b) => (
							<option key={b.name} value={b.name}>
								{b.name}
							</option>
						))}
					</select>
					{commits && (
						<span className="text-xs text-[var(--sea-ink-soft)]">
							{commits.length} commit{commits.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<Link to="/repo/$owner/$name" params={{ owner, name }}>
					<Button variant="outline" size="sm">
						Back to files
					</Button>
				</Link>
			</div>

			{/* Commits list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<div
							key={i}
							className="h-16 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)]"
						/>
					))}
				</div>
			) : !commits?.length ? (
				<div className="island-shell rounded-xl p-12 text-center">
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						No commits found in this branch.
					</p>
					<Link to="/repo/$owner/$name" params={{ owner, name }}>
						<Button variant="outline" size="sm">
							View files
						</Button>
					</Link>
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					{commits.map((commit, idx) => (
						<button
							type="button"
							key={commit.sha}
							className={`flex w-full items-center gap-4 p-4 text-left transition hover:bg-[var(--surface-strong)] ${idx < commits.length - 1 ? "border-b border-[var(--line)]" : ""}`}
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name/commit/$sha",
									params: { owner, name, sha: commit.sha },
								})
							}
						>
							<Avatar className="h-8 w-8 shrink-0">
								<AvatarFallback className="text-xs">
									{getInitials(commit.author?.name || commit.authorName || "U")}
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-[var(--sea-ink)]">
									{commit.message}
								</p>
								<p className="mt-0.5 text-xs text-[var(--sea-ink-soft)]">
									{commit.author?.name || commit.authorName || "Unknown"}{" "}
									&middot;{" "}
									{formatDistanceToNow(new Date(commit.createdAt), {
										addSuffix: true,
									})}
								</p>
							</div>
							<code className="shrink-0 rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sea-ink-soft)]">
								{commit.sha.substring(0, 7)}
							</code>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
