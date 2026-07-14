import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useCallback } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryCommitsQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

const PAGE_SIZE = 25;

export const Route = createFileRoute("/repo/$owner/$name/commits/$branch")({
	validateSearch: (search: Record<string, unknown>): { page?: number } => ({
		page: (search.page as number) || undefined,
	}),
	loaderDeps: ({ search }) => ({ page: search.page }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			const page = deps.page ?? 1;
			const skip = (page - 1) * PAGE_SIZE;
			await Promise.all([
				queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
				queryClient.ensureQueryData(
					repositoryCommitsQueryOptions({
						repoId: repo.id,
						branchName: params.branch,
						skip,
					}),
				),
			]);
		}
	},
	component: CommitsPage,
});

function CommitsPage() {
	const { owner, name, branch } = Route.useParams();
	const { page } = Route.useSearch();
	const navigate = useNavigate();
	const currentPage = page ?? 1;
	const currentSkip = (currentPage - 1) * PAGE_SIZE;

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: commits, isLoading } = useQuery({
		...repositoryCommitsQueryOptions({
			repoId: repo?.id ?? 0,
			branchName: branch,
			skip: currentSkip,
		}),
		enabled: !!repo,
	});

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const handleBranchChange = useCallback(
		(value: string) => {
			navigate({
				to: "/repo/$owner/$name/commits/$branch",
				params: { owner, name, branch: value },
			});
		},
		[navigate, owner, name],
	);

	return (
		<div className="space-y-5">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Select value={branch} onValueChange={handleBranchChange}>
						<SelectTrigger size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{branches?.map((b) => (
								<SelectItem key={b.name} value={b.name}>
									{b.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{commits && commits.length > 0 && (
						<span className="text-xs text-[var(--sea-ink-soft)]">
							{commits.length} commit{commits.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<BackLink
					to="/repo/$owner/$name/tree/$branch/$"
					params={{ owner, name, branch, _splat: "" }}
					label="Back to files"
				/>
			</div>

			{/* Commits list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-16" />
					))}
				</div>
			) : !commits?.length ? (
				<EmptyState
					message="No commits found in this branch."
					action={
						<Link
							to="/repo/$owner/$name/tree/$branch/$"
							params={{ owner, name, branch, _splat: "" }}
						>
							<Button variant="outline" size="sm">
								View files
							</Button>
						</Link>
					}
				/>
			) : (
				<>
					<div className="overflow-hidden rounded-xl border border-[var(--line)]">
						{commits.map((commit, idx) => (
							<Link
								key={commit.sha}
								to="/repo/$owner/$name/commit/$sha"
								params={{ owner, name, sha: commit.sha }}
								className={`flex w-full items-center gap-4 px-4 py-3.5 text-left no-underline transition hover:bg-[var(--surface-strong)] ${idx < commits.length - 1 ? "border-b border-[var(--line)]" : ""}`}
							>
								<Avatar className="h-8 w-8 shrink-0">
									<AvatarFallback className="text-xs">
										{getInitials(
											commit.author?.name || commit.authorName || "U",
										)}
									</AvatarFallback>
								</Avatar>
								<div className="min-w-0 flex-1 space-y-1">
									<p
										title={commit.message}
										className="truncate text-sm font-medium leading-snug text-[var(--sea-ink)]"
									>
										{commit.message.split("\n")[0]}
									</p>
									<p className="text-xs leading-snug text-[var(--sea-ink-soft)]">
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
							</Link>
						))}
					</div>

					{/* Pagination */}
					<div className="flex items-center justify-center gap-3">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1}
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name/commits/$branch",
									params: { owner, name, branch },
									search: { page: Math.max(1, currentPage - 1) },
								})
							}
						>
							Previous
						</Button>
						<span className="text-xs text-[var(--sea-ink-soft)]">
							{currentSkip + 1}–{currentSkip + commits.length}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={commits.length < PAGE_SIZE}
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name/commits/$branch",
									params: { owner, name, branch },
									search: { page: currentPage + 1 },
								})
							}
						>
							Next
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
