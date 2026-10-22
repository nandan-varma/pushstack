import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { FolderTree } from "lucide-react";
import { useMemo } from "react";
import { CopyField } from "@/components/CopyField";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { NotFoundCard } from "@/components/NotFoundCard";
import { CommitComments } from "@/components/repo/CommitComments";
import { CommitMessage } from "@/components/repo/CommitMessage";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { splitPatchSuffix } from "@/lib/compare-spec";
import {
	repositoryByNameQueryOptions,
	repositoryCommitDiffQueryOptions,
	repositoryCommitQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
} from "@/lib/query-options";
import { createReferenceResolver } from "@/lib/reference-patterns";
import { getInitials } from "@/lib/utils/avatar";

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export const Route = createFileRoute("/$owner/$name/commit/$sha")({
	// `/commit/{sha}.diff` and `.patch` are plain text, as on GitHub.
	server: {
		handlers: {
			GET: async ({ params, next }) => {
				const suffix = splitPatchSuffix(params.sha);
				if (!suffix) return next();
				const { serveCommitPatch } = await import("#/server/web-patches");
				return serveCommitPatch(
					params.owner,
					params.name,
					suffix.name,
					suffix.format,
				);
			},
		},
	},
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			queryClient
				.ensureQueryData(repositoryIssueNumbersQueryOptions(repo.id))
				.catch(() => {});
			queryClient
				.ensureQueryData(repositoryPullRequestNumbersQueryOptions(repo.id))
				.catch(() => {});

			// Diff computation is comparatively expensive and not needed for the
			// header — fetch it client-side (own loading state below) instead of
			// blocking the route transition on it. A full sha already names the
			// diff, so it starts now, alongside the commit.
			if (FULL_SHA_RE.test(params.sha)) {
				queryClient
					.prefetchQuery(
						repositoryCommitDiffQueryOptions({
							repoId: repo.id,
							commitSha: params.sha.toLowerCase(),
						}),
					)
					.catch(() => {});
			}
			await queryClient.ensureQueryData(
				repositoryCommitQueryOptions({
					repoId: repo.id,
					rev: params.sha,
				}),
			);
		}
	},
	component: CommitDetailPage,
	notFoundComponent: () => (
		<RepoResourceNotFound
			title="Commit not found"
			message="This commit doesn't exist in the repository."
		/>
	),
});

function CommitDetailPage() {
	const { owner, name, sha } = Route.useParams();

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: commit, isLoading: commitLoading } = useQuery({
		...repositoryCommitQueryOptions({
			repoId: repo?.id ?? 0,
			rev: sha,
		}),
		enabled: !!repo,
	});

	// The diff is read by oid, so a branch or abbreviated sha in the URL shares
	// the cached diff of the commit it names. A full sha is already the oid:
	// the diff then loads in parallel with the commit, not after it.
	const diffSha = FULL_SHA_RE.test(sha) ? sha.toLowerCase() : commit?.sha;
	const { data: diffData, isLoading: diffLoading } = useQuery({
		...repositoryCommitDiffQueryOptions({
			repoId: repo?.id ?? 0,
			commitSha: diffSha ?? "",
		}),
		enabled: !!repo && !!diffSha,
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
		return createReferenceResolver(issueNumbers ?? [], prNumbers ?? []);
	}, [issueNumbers, prNumbers]);

	if (commitLoading) {
		return (
			<div className="space-y-5" aria-busy="true">
				<div className="space-y-3 border-b border-bjork-border-muted pb-5">
					<Skeleton className="h-7 w-2/3 max-w-lg" />
					<div className="flex items-center gap-3">
						<Skeleton className="size-6 rounded-full" />
						<Skeleton className="h-4 w-48" />
						<Skeleton className="h-8 w-72 rounded-[12px]" />
					</div>
				</div>
				<FileDiffViewer isLoading />
			</div>
		);
	}

	if (!commit) {
		return (
			<NotFoundCard
				title="Commit Not Found"
				message={`The commit with SHA "${sha}" does not exist.`}
				backTo="/$owner/$name"
				backParams={{ owner, name }}
				backLabel="Back to repository"
			/>
		);
	}

	const authoredAt = new Date(commit.author.date);

	return (
		<div className="space-y-5">
			<header className="space-y-3 border-b border-bjork-border-muted pb-5">
				<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
					<div className="min-w-0 flex-1 basis-96">
						<CommitMessage
							message={commit.message}
							owner={owner}
							name={name}
							resolveReference={resolveReference}
						/>
					</div>
					<Link
						to="/$owner/$name/tree/$branch/$"
						params={{ owner, name, branch: commit.sha, _splat: "" }}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<FolderTree aria-hidden="true" />
						Browse files
					</Link>
				</div>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-bjork-text-muted">
					<span className="flex items-center gap-2">
						<Avatar size="sm">
							<AvatarFallback className="text-[11px]">
								{getInitials(commit.author.name)}
							</AvatarFallback>
						</Avatar>
						<span className="font-medium text-bjork-text">
							{commit.author.name}
						</span>
						committed
						<time
							dateTime={authoredAt.toISOString()}
							title={format(authoredAt, "PPpp")}
						>
							{formatDistanceToNow(authoredAt, { addSuffix: true })}
						</time>
					</span>
					<span aria-hidden="true" className="text-bjork-text-faint">
						·
					</span>
					<CopyField
						value={commit.sha}
						label="Copy commit SHA"
						className="h-8 w-[min(23rem,100%)]"
					/>
					{commit.parents.length > 0 && (
						<span className="text-xs text-bjork-text-soft">
							{commit.parents.length > 1 ? "Parents" : "Parent"}{" "}
							{commit.parents.map((p, i) => (
								<span key={p}>
									{i > 0 && ", "}
									<Link
										to="/$owner/$name/commit/$sha"
										params={{ owner, name, sha: p }}
										className="font-mono text-bjork-text-medium hover:text-bjork-accent"
									>
										{p.substring(0, 7)}
									</Link>
								</span>
							))}
						</span>
					)}
				</div>
			</header>

			<FileDiffViewer
				files={diffData?.files}
				sides={{ owner, name, oldRef: commit.parents[0], newRef: commit.sha }}
				isLoading={diffLoading}
			/>
			{repo && (
				<CommitComments
					repoId={repo.id}
					sha={commit.sha}
					owner={owner}
					name={name}
				/>
			)}
		</div>
	);
}
