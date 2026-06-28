import { queryOptions } from "@tanstack/react-query";
import { getSession } from "@/lib/auth-session";
import {
	getBranches,
	getCommit,
	getCommitDiff,
	getCommits,
	getFile,
	listFiles,
} from "@/server/files";
import {
	getComments,
	getIssue,
	getIssues,
	getPullRequest,
	getPullRequests,
} from "@/server/issues";
import {
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
	repoFilesRoot: (repoId: number) => ["repos", repoId, "files"] as const,
	repoFiles: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "files", branchName, path] as const,
	repoFile: (repoId: number, branchName: string, path: string) =>
		["repos", repoId, "file", branchName, path] as const,
	repoCommitsRoot: (repoId: number) => ["repos", repoId, "commits"] as const,
	repoCommits: (repoId: number, branchName: string, limit = 50, skip = 0) =>
		["repos", repoId, "commits", branchName, limit, skip] as const,
	repoCommit: (repoId: number, commitSha: string) =>
		["repos", repoId, "commit", commitSha] as const,
	repoCommitDiff: (repoId: number, commitSha: string) =>
		["repos", repoId, "commit-diff", commitSha] as const,
	repoIssues: (repoId: number, status: "open" | "closed" | "all") =>
		["repos", repoId, "issues", status] as const,
	repoIssuesRoot: (repoId: number) => ["repos", repoId, "issues"] as const,
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
} as const;

const SESSION_STALE_TIME = 60_000;
const DEFAULT_STALE_TIME = 2 * 60_000;
const LONG_LIVED_STALE_TIME = 10 * 60_000;
const IMMUTABLE_STALE_TIME = 30 * 60_000;

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
		queryFn: () => getRepositoryByName({ data: { owner, name } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryBranchesQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoBranches(repoId),
		queryFn: () => getBranches({ data: { repoId } }),
		staleTime: LONG_LIVED_STALE_TIME,
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
		queryFn: () => listFiles({ data: { repoId, branchName, path } }),
		staleTime: LONG_LIVED_STALE_TIME,
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
		queryFn: () => getFile({ data: { repoId, branchName, path } }),
		staleTime: IMMUTABLE_STALE_TIME,
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
		queryFn: () => getCommits({ data: { repoId, branchName, limit, skip } }),
		staleTime: LONG_LIVED_STALE_TIME,
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
		staleTime: LONG_LIVED_STALE_TIME,
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
		staleTime: LONG_LIVED_STALE_TIME,
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
