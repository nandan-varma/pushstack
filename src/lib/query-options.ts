import { queryOptions } from "@tanstack/react-query";
import { getSession } from "@/lib/auth-session";
import { perfTime } from "@/lib/perf-log";
import { getComments } from "@/server/comments";
import {
	getBranchDiff,
	getBranches,
	getBranchHead,
	getCommit,
	getCommitDiff,
	getCommits,
	getFile,
	getFileHistory,
	getLastCommits,
	listFiles,
} from "@/server/files";
import { getIssue, getIssueNumbers, getIssues } from "@/server/issues";
import {
	getPullRequest,
	getPullRequestNumbers,
	getPullRequests,
} from "@/server/pull-requests";
import {
	getCollaborators,
	getRepositoryByName,
	getUserRepositories,
} from "@/server/repositories";
import { getUserActivity } from "@/server/search";

export const queryKeys = {
	authSession: ["auth", "session"] as const,
	userRepositories: (userId?: string) =>
		["repositories", "user", userId ?? "self"] as const,
	repositoriesRoot: ["repositories"] as const,
	repositoryByName: (owner: string, name: string) =>
		["repositories", "by-name", owner, name] as const,
	userActivity: (userId: string | undefined, limit: number) =>
		["activity", "user", userId ?? "self", limit] as const,
	repoBranches: (repoId: number) => ["repos", repoId, "branches"] as const,
	repoBranchHead: (repoId: number, branchName: string) =>
		["repos", repoId, "branch-head", branchName] as const,
	repoFilesRoot: (repoId: number) => ["repos", repoId, "files"] as const,
	repoFiles: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "files", branchName, path] as const,
	repoFile: (repoId: number, branchName: string, path: string) =>
		["repos", repoId, "files", "content", branchName, path] as const,
	repoCommitsRoot: (repoId: number) => ["repos", repoId, "commits"] as const,
	repoCommits: (repoId: number, branchName: string, limit = 50, skip = 0) =>
		["repos", repoId, "commits", branchName, limit, skip] as const,
	repoCommit: (repoId: number, commitSha: string) =>
		["repos", repoId, "commit", commitSha] as const,
	repoCommitDiff: (repoId: number, commitSha: string) =>
		["repos", repoId, "commit-diff", commitSha] as const,
	repoLastCommits: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "last-commits", branchName, path] as const,
	repoFileHistory: (
		repoId: number,
		branchName: string,
		path: string,
		limit = 30,
	) => ["repos", repoId, "file-history", branchName, path, limit] as const,
	repoIssues: (repoId: number, status: "open" | "closed" | "all") =>
		["repos", repoId, "issues", status] as const,
	repoIssuesRoot: (repoId: number) => ["repos", repoId, "issues"] as const,
	repoIssueNumbers: (repoId: number) =>
		["repos", repoId, "issue-numbers"] as const,
	repoPullRequestNumbers: (repoId: number) =>
		["repos", repoId, "pull-request-numbers"] as const,
	issue: (issueId: number) => ["issues", issueId] as const,
	issueComments: (issueId: number) => ["issues", issueId, "comments"] as const,
	pullRequests: (
		repoId: number,
		status: "open" | "closed" | "merged" | "all",
	) => ["repos", repoId, "pull-requests", status] as const,
	pullRequestsRoot: (repoId: number) =>
		["repos", repoId, "pull-requests"] as const,
	pullRequest: (prId: number) => ["pull-requests", prId] as const,
	pullRequestComments: (prId: number) =>
		["pull-requests", prId, "comments"] as const,
	pullRequestDiff: (
		repoId: number,
		sourceBranch: string,
		targetBranch: string,
	) =>
		["repos", repoId, "pull-request-diff", sourceBranch, targetBranch] as const,
	repoCollaborators: (repoId: number) =>
		["repos", repoId, "collaborators"] as const,
} as const;

const SESSION_STALE_TIME = 60_000;
const DEFAULT_STALE_TIME = 2 * 60_000;
const LONG_LIVED_STALE_TIME = 10 * 60_000;
// React Query's default gcTime (5min) is shorter than LONG_LIVED_STALE_TIME, so
// unobserved long-lived entries (e.g. a branch list, or a commit tab the user
// tabbed away from) were getting garbage-collected before they ever went stale —
// silently forcing a refetch that staleTime said shouldn't be needed yet.
const LONG_LIVED_GC_TIME = 30 * 60_000;
// Commits and their diffs are addressed by SHA — content-addressed and immutable,
// so once fetched they never need a background refetch.
const IMMUTABLE_STALE_TIME = Number.POSITIVE_INFINITY;
const IMMUTABLE_GC_TIME = 60 * 60_000;

export function authSessionQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.authSession,
		queryFn: () => getSession(),
		staleTime: SESSION_STALE_TIME,
		gcTime: 30 * 60_000,
	});
}

export function userRepositoriesQueryOptions(userId?: string) {
	return queryOptions({
		queryKey: queryKeys.userRepositories(userId),
		queryFn: () => getUserRepositories({ data: userId ? { userId } : {} }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function userActivityQueryOptions({
	userId,
	limit = 20,
}: {
	userId?: string;
	limit?: number;
}) {
	return queryOptions({
		queryKey: queryKeys.userActivity(userId, limit),
		queryFn: () =>
			getUserActivity({ data: { ...(userId ? { userId } : {}), limit } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryByNameQueryOptions({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repositoryByName(owner, name),
		queryFn: () =>
			perfTime(`query repositoryByName ${owner}/${name}`, () =>
				getRepositoryByName({ data: { owner, name } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryBranchesQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoBranches(repoId),
		queryFn: () =>
			perfTime(`query branches repo=${repoId}`, () =>
				getBranches({ data: { repoId } }),
			),
		staleTime: LONG_LIVED_STALE_TIME,
		gcTime: LONG_LIVED_GC_TIME,
	});
}

// Deliberately the opposite of every other query here: staleTime 0 and a short
// refetchInterval, because this query *is* the polling mechanism — see
// BranchUpdateBanner, which compares successive results against the sha that was
// current when the page loaded to detect a push that landed while the user was
// looking at (possibly long-cached) tree/commit data, without ever blocking the
// initial render on a live check.
export function repositoryBranchHeadQueryOptions({
	repoId,
	branchName,
}: {
	repoId: number;
	branchName: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoBranchHead(repoId, branchName),
		queryFn: () =>
			perfTime(`query branch-head repo=${repoId} ${branchName}`, () =>
				getBranchHead({ data: { repoId, branchName } }),
			),
		staleTime: 0,
		refetchInterval: 20_000,
		refetchOnWindowFocus: true,
		enabled: Boolean(repoId && branchName),
	});
}

export function repositoryFilesQueryOptions({
	repoId,
	branchName,
	path = "",
}: {
	repoId: number;
	branchName: string;
	path?: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoFiles(repoId, branchName, path),
		queryFn: () =>
			perfTime(`query files repo=${repoId} ${branchName}:${path || "/"}`, () =>
				listFiles({ data: { repoId, branchName, path } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryFileQueryOptions({
	repoId,
	branchName,
	path,
}: {
	repoId: number;
	branchName: string;
	path: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoFile(repoId, branchName, path),
		queryFn: () =>
			perfTime(`query file repo=${repoId} ${branchName}:${path}`, () =>
				getFile({ data: { repoId, branchName, path } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryFileHistoryQueryOptions({
	repoId,
	branchName,
	path,
	limit = 30,
}: {
	repoId: number;
	branchName: string;
	path: string;
	limit?: number;
}) {
	return queryOptions({
		queryKey: queryKeys.repoFileHistory(repoId, branchName, path, limit),
		queryFn: () =>
			perfTime(
				`query file history repo=${repoId} ${branchName}:${path} limit=${limit}`,
				() => getFileHistory({ data: { repoId, branchName, path, limit } }),
			),
		staleTime: LONG_LIVED_STALE_TIME,
		gcTime: LONG_LIVED_GC_TIME,
	});
}

export function repositoryCommitsQueryOptions({
	repoId,
	branchName,
	limit = 50,
	skip = 0,
}: {
	repoId: number;
	branchName: string;
	limit?: number;
	skip?: number;
}) {
	return queryOptions({
		queryKey: queryKeys.repoCommits(repoId, branchName, limit, skip),
		queryFn: () =>
			perfTime(
				`query commits repo=${repoId} ${branchName} limit=${limit}`,
				() => getCommits({ data: { repoId, branchName, limit, skip } }),
			),
		staleTime: LONG_LIVED_STALE_TIME,
		gcTime: LONG_LIVED_GC_TIME,
	});
}

export function repositoryCommitQueryOptions({
	repoId,
	commitSha,
}: {
	repoId: number;
	commitSha: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoCommit(repoId, commitSha),
		queryFn: () => getCommit({ data: { repoId, commitSha } }),
		staleTime: IMMUTABLE_STALE_TIME,
		gcTime: IMMUTABLE_GC_TIME,
	});
}

export function repositoryCommitDiffQueryOptions({
	repoId,
	commitSha,
}: {
	repoId: number;
	commitSha: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoCommitDiff(repoId, commitSha),
		queryFn: () => getCommitDiff({ data: { repoId, commitSha } }),
		staleTime: IMMUTABLE_STALE_TIME,
		gcTime: IMMUTABLE_GC_TIME,
	});
}

export function repositoryLastCommitsQueryOptions({
	repoId,
	branchName,
	path = "",
}: {
	repoId: number;
	branchName: string;
	path?: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoLastCommits(repoId, branchName, path),
		queryFn: () =>
			perfTime(
				`query lastCommits repo=${repoId} ${branchName}:${path || "/"}`,
				() => getLastCommits({ data: { repoId, branchName, path } }),
			),
		staleTime: LONG_LIVED_STALE_TIME,
		gcTime: LONG_LIVED_GC_TIME,
	});
}

export function repositoryIssueNumbersQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoIssueNumbers(repoId),
		queryFn: () => getIssueNumbers({ data: { repoId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryPullRequestNumbersQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoPullRequestNumbers(repoId),
		queryFn: () => getPullRequestNumbers({ data: { repoId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryIssuesQueryOptions({
	repoId,
	status,
}: {
	repoId: number;
	status: "open" | "closed" | "all";
}) {
	return queryOptions({
		queryKey: queryKeys.repoIssues(repoId, status),
		queryFn: () => getIssues({ data: { repoId, status } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function issueQueryOptions(issueId: number) {
	return queryOptions({
		queryKey: queryKeys.issue(issueId),
		queryFn: () => getIssue({ data: { issueId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function issueCommentsQueryOptions(issueId: number) {
	return queryOptions({
		queryKey: queryKeys.issueComments(issueId),
		queryFn: () => getComments({ data: { issueId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryPullRequestsQueryOptions({
	repoId,
	status,
}: {
	repoId: number;
	status: "open" | "closed" | "merged" | "all";
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequests(repoId, status),
		queryFn: () =>
			getPullRequests({
				data: status === "all" ? { repoId } : { repoId, status },
			}),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function pullRequestQueryOptions(prId: number) {
	return queryOptions({
		queryKey: queryKeys.pullRequest(prId),
		queryFn: () => getPullRequest({ data: { prId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function pullRequestCommentsQueryOptions(prId: number) {
	return queryOptions({
		queryKey: queryKeys.pullRequestComments(prId),
		queryFn: () => getComments({ data: { pullRequestId: prId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function pullRequestDiffQueryOptions({
	repoId,
	sourceBranch,
	targetBranch,
}: {
	repoId: number;
	sourceBranch: string;
	targetBranch: string;
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequestDiff(repoId, sourceBranch, targetBranch),
		queryFn: () =>
			getBranchDiff({ data: { repoId, sourceBranch, targetBranch } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repoCollaboratorsQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoCollaborators(repoId),
		queryFn: () => getCollaborators({ data: { repoId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}
