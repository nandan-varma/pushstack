import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	repositoryByNameQueryOptions,
	repositoryCommitDiffQueryOptions,
	repositoryCommitQueryOptions,
} from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

export const Route = createFileRoute("/repo/$owner/$name/commit/$sha")({
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

	const isLoading = commitLoading || diffLoading;

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-1/2" />
				<Skeleton className="h-64" />
			</div>
		);
	}

	if (!commit) {
		return (
			<Card className="p-6">
				<h2 className="mb-2 text-xl font-semibold text-[var(--sea-ink)]">
					Commit Not Found
				</h2>
				<p className="text-[var(--sea-ink-soft)] mb-4">
					The commit with SHA "{sha}" does not exist.
				</p>
				<Link
					to="/repo/$owner/$name/commits/$branch"
					params={{ owner, name, branch: repo?.defaultBranch || "main" }}
					className="inline-block"
				>
					<Button variant="outline">Back to Commits</Button>
				</Link>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1">
					<h1
						title={commit.message}
						className="line-clamp-2 text-3xl font-bold text-[var(--sea-ink)] mb-2"
					>
						{commit.message}
					</h1>
					<div className="flex items-center gap-3 text-[var(--sea-ink-soft)]">
						<code className="px-2 py-1 rounded bg-[var(--chip-bg)] text-[var(--sea-ink)] border border-[var(--chip-line)] text-sm font-mono">
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
				<Link
					to="/repo/$owner/$name/commits/$branch"
					params={{ owner, name, branch: commit.branch }}
				>
					<Button variant="outline" size="sm">
						Back to Commits
					</Button>
				</Link>
			</div>

			{/* Commit Info */}
			<Card className="p-6">
				<div className="flex items-start gap-4">
					<Avatar className="h-12 w-12">
						<AvatarFallback>
							{getInitials(commit.author?.name || "U")}
						</AvatarFallback>
					</Avatar>
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-2">
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
								<p className="font-medium text-[var(--sea-ink)]">
									{diffData?.files?.length || 0} file
									{diffData?.files?.length !== 1 ? "s" : ""}
								</p>
							</div>
							<div>
								<p className="text-[var(--sea-ink-soft)]">Stats</p>
								<p className="font-medium text-[var(--sea-ink)]">
									<span className="text-green-600">
										+{diffData?.totalAdditions || 0}
									</span>{" "}
									<span className="text-red-600">
										-{diffData?.totalDeletions || 0}
									</span>
								</p>
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
