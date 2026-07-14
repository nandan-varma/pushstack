import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { useMemo } from "react";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { NotFoundCard } from "@/components/NotFoundCard";
import { CommitMessage } from "@/components/repo/CommitMessage";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryCommitDiffQueryOptions,
	repositoryCommitQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import type { ReferenceKind } from "@/lib/reference-patterns";
import { getInitials } from "@/lib/utils/avatar";

export const Route = createFileRoute("/repo/$owner/$name/commit/$sha")({
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			// CommitMessage resolves `#123` references using these — previously only
			// fetched client-side after mount (no loader prefetched them), tacking an
			// extra round trip onto the header render. Fire-and-forget since the page
			// is still useful without them resolved yet.
			queryClient
				.ensureQueryData(repositoryIssueNumbersQueryOptions(repo.id))
				.catch(() => {});
			queryClient
				.ensureQueryData(repositoryPullRequestNumbersQueryOptions(repo.id))
				.catch(() => {});

			// Diff computation is comparatively expensive and not needed for the
			// header — fetch it client-side (own loading state below) instead of
			// blocking the route transition on it.
			await queryClient.ensureQueryData(
				repositoryCommitQueryOptions({
					repoId: repo.id,
					commitSha: params.sha,
				}),
			);
		}
	},
	component: CommitDetailPage,
});

function CommitDetailPage() {
	const { owner, name, sha } = Route.useParams();

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: commit, isLoading: commitLoading } = useQuery({
		...repositoryCommitQueryOptions({
			repoId: repo?.id ?? 0,
			commitSha: sha,
		}),
		enabled: !!repo,
	});

	const { data: diffData, isLoading: diffLoading } = useQuery({
		...repositoryCommitDiffQueryOptions({
			repoId: repo?.id ?? 0,
			commitSha: sha,
		}),
		enabled: !!repo,
	});

	const { data: issueNumbers } = useQuery({
		...repositoryIssueNumbersQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});
	const { data: prNumbers } = useQuery({
		...repositoryPullRequestNumbersQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});

	const resolveReference = useMemo(() => {
		const issueSet = new Set(issueNumbers ?? []);
		const prSet = new Set(prNumbers ?? []);
		return (num: number): ReferenceKind | null => {
			if (prSet.has(num)) return "pull";
			if (issueSet.has(num)) return "issue";
			return null;
		};
	}, [issueNumbers, prNumbers]);

	if (commitLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-1/2" />
				<Skeleton className="h-64" />
			</div>
		);
	}

	if (!commit) {
		return (
			<NotFoundCard
				title="Commit Not Found"
				message={`The commit with SHA "${sha}" does not exist.`}
				backTo="/repo/$owner/$name/commits/$branch"
				backParams={{ owner, name, branch: repo?.defaultBranch || "main" }}
				backLabel="Back to Commits"
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col-reverse gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
				<div className="min-w-0 flex-1">
					<CommitMessage
						message={commit.message}
						owner={owner}
						name={name}
						resolveReference={resolveReference}
					/>
					<div className="mt-3 flex flex-wrap items-center gap-3 text-[var(--sea-ink-soft)]">
						<code className="max-w-full truncate rounded border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-1 font-mono text-sm text-[var(--sea-ink)]">
							{commit.sha}
						</code>
						{commit.parent && commit.parent.length > 0 && (
							<span className="text-xs text-[var(--sea-ink-soft)]">
								Parent:{" "}
								{commit.parent.map((p: string, i: number) => (
									<span key={p}>
										{i > 0 && ", "}
										<Link
											to="/repo/$owner/$name/commit/$sha"
											params={{ owner, name, sha: p }}
											className="font-mono text-[var(--lagoon-deep)] hover:underline"
										>
											{p.substring(0, 7)}
										</Link>
									</span>
								))}
							</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
					<Link
						to="/repo/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: commit.sha, _splat: "" }}
					>
						<Button size="sm" variant="outline">
							Browse files
						</Button>
					</Link>
					<BackLink
						to="/repo/$owner/$name/commits/$branch"
						params={{ owner, name, branch: commit.branch }}
						label="Back to Commits"
					/>
				</div>
			</div>

			{/* Commit Info */}
			<Card className="p-6">
				<div className="flex items-start gap-4">
					<Avatar className="h-12 w-12">
						<AvatarFallback>
							{getInitials(commit.author?.name || "U")}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<div className="mb-2 flex flex-wrap items-center gap-2">
							<span className="font-medium text-[var(--sea-ink)]">
								{commit.author?.name || "Unknown"}
							</span>
							<span className="text-sm text-[var(--sea-ink-soft)]">
								committed{" "}
								{formatDistanceToNow(
									new Date(commit.author?.date || new Date()),
									{
										addSuffix: true,
									},
								)}
							</span>
						</div>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4">
							<div>
								<p className="text-[var(--sea-ink-soft)]">Commit SHA</p>
								<code className="text-xs font-mono text-[var(--sea-ink)]">
									{commit.sha.substring(0, 7)}
								</code>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Timestamp</p>
								<p className="font-medium text-[var(--sea-ink)]">
									{format(new Date(commit.author?.date || new Date()), "PPp")}
								</p>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Changes</p>
								{diffLoading ? (
									<div className="mt-1 h-4 w-16 animate-pulse rounded bg-[var(--surface-raised)]" />
								) : (
									<p className="font-medium text-[var(--sea-ink)]">
										{diffData?.files?.length || 0} file
										{diffData?.files?.length !== 1 ? "s" : ""}
									</p>
								)}
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Stats</p>
								{diffLoading ? (
									<div className="mt-1 h-4 w-16 animate-pulse rounded bg-[var(--surface-raised)]" />
								) : (
									<p className="font-medium text-[var(--sea-ink)]">
										<span className="text-green-600">
											+{diffData?.totalAdditions || 0}
										</span>{" "}
										<span className="text-red-600">
											-{diffData?.totalDeletions || 0}
										</span>
									</p>
								)}
							</div>
						</div>
					</div>
				</div>
			</Card>

			{/* File Changes */}
			<div className="space-y-4">
				<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
					File Changes {diffData?.files && `(${diffData.files.length})`}
				</h2>
				<FileDiffViewer files={diffData?.files} isLoading={diffLoading} />
			</div>
		</div>
	);
}
