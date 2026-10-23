import {
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { MAX_LIST_SKIP, THREAD_PAGE_SIZE } from "#/lib/limits";
import { getSession } from "@/lib/auth-session";
import { perfTime } from "@/lib/perf-log";
import { getAssignableUsers, getAssignedThreads } from "@/server/assignees";
import { getComments } from "@/server/comments";
import { getCommitComments } from "@/server/commit-comments";
import {
	getBlame,
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitDiff,
	getCommits,
	getComparison,
	getFile,
	getFileHistory,
	getLastCommits,
	getTags,
	getTreeEntries,
	getTreePageData,
} from "@/server/files";
import { listProfileConnections } from "@/server/follows";
import { getIssueByNumber, getIssueNumbers, getIssues } from "@/server/issues";
import { getLabels } from "@/server/labels";
import {
	getMilestoneByNumber,
	getMilestones,
	getMilestoneThreads,
} from "@/server/milestones";
import {
	getNotifications,
	getThreadSubscription,
	getUnreadNotificationCount,
} from "@/server/notifications";
import {
	getPullRequestByNumber,
	getPullRequestCommits,
	getPullRequestNumbers,
	getPullRequests,
} from "@/server/pull-requests";
import { getThreadReactions } from "@/server/reactions";
import {
	getCollaborators,
	getRepositoryByName,
	getUserRepositories,
} from "@/server/repositories";
import {
	getMyPendingReview,
	getPullRequestReviewThreads,
} from "@/server/reviews";
import {
	getUserActivity,
	searchRepositories,
	searchUsers,
} from "@/server/search";
import { getTimeline } from "@/server/timeline";
import { listTokens } from "@/server/tokens";
import { getUserProfile } from "@/server/users";

export const queryKeys = {
	assignedThreads: ["threads", "assigned", "self"] as const,
	authSession: ["auth", "session"] as const,
	accessTokens: ["auth", "access-tokens"] as const,
	authSessions: ["auth", "sessions"] as const,
	userRepositories: (userId?: string) =>
		["repositories", "user", userId ?? "self"] as const,
	repositoriesRoot: ["repositories"] as const,
	repositoryByName: (owner: string, name: string) =>
		["repositories", "by-name", owner, name] as const,
	userActivity: (userId: string | undefined, limit: number) =>
		["activity", "user", userId ?? "self", limit] as const,
	userProfile: (username: string) => ["users", "profile", username] as const,
	searchRepositories: (query: string) =>
		["search", "repositories", query] as const,
	searchUsers: (query: string) => ["search", "users", query] as const,
	repoBranches: (repoId: number) => ["repos", repoId, "branches"] as const,
	repoTags: (repoId: number) => ["repos", repoId, "tags"] as const,
	/** Every timeline in a repo: a mention, merge or close can touch several. */
	timelineRoot: (repoId: number) => ["repos", repoId, "timeline"] as const,
	timeline: (repoId: number, number: number) =>
		["repos", repoId, "timeline", number] as const,
	threadReactions: (repoId: number, number: number) =>
		["repos", repoId, "reactions", number] as const,
	threadSubscription: (repoId: number, number: number) =>
		["repos", repoId, "subscription", number] as const,
	/** The inbox lists and the unread badge: every notification read. */
	notificationsRoot: ["notifications"] as const,
	notifications: (filter: {
		all: boolean;
		participating: boolean;
		page: number;
	}) =>
		[
			"notifications",
			"list",
			filter.all,
			filter.participating,
			filter.page,
		] as const,
	unreadNotificationCount: ["notifications", "unread-count"] as const,
	/**
	 * Everything a write to a branch's content can change: file views, tree
	 * pages, last commits and file history. An upload or a merge invalidates
	 * this one root, so every key read from a branch's tree must sit under it.
	 */
	repoFilesRoot: (repoId: number) => ["repos", repoId, "files"] as const,
	repoTreeEntries: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "tree-entries", branchName, path] as const,
	repoTreePage: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "files", "tree-page", branchName, path] as const,
	repoFile: (repoId: number, branchName: string, path: string) =>
		["repos", repoId, "files", "content", branchName, path] as const,
	repoCommitsRoot: (repoId: number) => ["repos", repoId, "commits"] as const,
	repoCommits: (repoId: number, branchName: string, limit = 50, skip = 0) =>
		["repos", repoId, "commits", branchName, limit, skip] as const,
	repoCommit: (repoId: number, rev: string) =>
		["repos", repoId, "commit", rev] as const,
	commitComments: (repoId: number, sha: string) =>
		["repos", repoId, "commit-comments", sha] as const,
	repoCommitDiff: (repoId: number, commitSha: string) =>
		["repos", repoId, "commit-diff", commitSha] as const,
	repoLastCommits: (repoId: number, branchName: string, path = "") =>
		["repos", repoId, "files", "last-commits", branchName, path] as const,
	repoFileHistory: (
		repoId: number,
		branchName: string,
		path: string,
		limit = 30,
		depth: "banner" | "full" = "full",
	) =>
		[
			"repos",
			repoId,
			"files",
			"file-history",
			branchName,
			path,
			limit,
			depth,
		] as const,
	repoBlame: (repoId: number, branchName: string, path: string) =>
		["repos", repoId, "files", "blame", branchName, path] as const,
	repoAssignable: (repoId: number) =>
		["repos", repoId, "assignable-users"] as const,
	repoLabels: (repoId: number) => ["repos", repoId, "labels"] as const,
	repoMilestones: (repoId: number) => ["repos", repoId, "milestones"] as const,
	repoMilestoneList: (repoId: number, state: string) =>
		["repos", repoId, "milestones", "list", state] as const,
	repoMilestone: (repoId: number, number: number) =>
		["repos", repoId, "milestones", number] as const,
	repoMilestoneThreads: (repoId: number, number: number, state: string) =>
		["repos", repoId, "milestones", number, "threads", state] as const,
	repoIssuesRoot: (repoId: number) => ["repos", repoId, "issues"] as const,
	repoIssueNumbers: (repoId: number) =>
		["repos", repoId, "issue-numbers"] as const,
	repoPullRequestNumbers: (repoId: number) =>
		["repos", repoId, "pull-request-numbers"] as const,
	/**
	 * Two key families live under `["repos", …]`: the list and detail reads
	 * addressed by `repoId`, and the URL-addressed single-resource reads keyed by
	 * owner/name (below), because that is what their routes and server functions
	 * take. A mutation has to invalidate the entry it changed — a `repoId`
	 * prefix does not reach an owner/name entry — which is why each mutation
	 * invalidates its own detail key as well as the list root.
	 */
	issueByNumber: (owner: string, name: string, number: number) =>
		["repos", owner, name, "issues", number] as const,
	issueComments: (issueId: number) => ["issues", issueId, "comments"] as const,
	pullRequestsRoot: (repoId: number) =>
		["repos", repoId, "pull-requests"] as const,
	pullRequestByNumber: (owner: string, name: string, number: number) =>
		["repos", owner, name, "pull-requests", number] as const,
	pullRequestComments: (prId: number) =>
		["pull-requests", prId, "comments"] as const,
	pullRequestCommits: (prId: number) =>
		["pull-requests", prId, "commits"] as const,
	comparison: (
		repoId: number,
		base: string,
		head: string,
		separator: "..." | ".." = "...",
	) => ["repos", repoId, "compare", base, head, separator] as const,
	pullRequestDiff: (
		repoId: number,
		sourceBranch: string,
		targetBranch: string,
	) =>
		["repos", repoId, "pull-request-diff", sourceBranch, targetBranch] as const,
	repoCollaborators: (repoId: number) =>
		["repos", repoId, "collaborators"] as const,
	pullRequestReviewThreads: (prId: number) =>
		["pull-requests", prId, "review-threads"] as const,
	pullRequestPendingReview: (prId: number) =>
		["pull-requests", prId, "pending-review"] as const,
	repoIssueSearch: (repoId: number, query: string) =>
		["repos", repoId, "issues", "search", query] as const,
	pullRequestSearch: (repoId: number, query: string) =>
		["repos", repoId, "pull-requests", "search", query] as const,
} as const;

const SESSION_STALE_TIME = 60_000;
const DEFAULT_STALE_TIME = 2 * 60_000;
const LONG_LIVED_STALE_TIME = 10 * 60_000;
// Longer than LONG_LIVED_STALE_TIME: the default gcTime (5min) would collect an
// unobserved entry before it ever went stale, forcing a pointless refetch.
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

export function accessTokensQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.accessTokens,
		queryFn: () => listTokens(),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function authSessionsQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.authSessions,
		queryFn: async () => {
			const { authClient } = await import("@/lib/auth-client");
			const { data, error } = await authClient.listSessions();
			if (error) throw new Error(error.message ?? "Failed to list sessions");
			return data;
		},
		staleTime: DEFAULT_STALE_TIME,
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

export function profileConnectionsQueryOptions(
	username: string,
	kind: "followers" | "following",
) {
	return queryOptions({
		queryKey: [...queryKeys.userProfile(username), kind] as const,
		queryFn: () => listProfileConnections({ data: { username, kind } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function userProfileQueryOptions(username: string) {
	return queryOptions({
		queryKey: queryKeys.userProfile(username),
		queryFn: () =>
			perfTime(`query userProfile ${username}`, () =>
				getUserProfile({ data: { username } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

// Search-as-you-navigate results are keyed by the exact query string; a short
// staleTime keeps back/forward between result pages instant without holding
// stale hits for long.
const SEARCH_STALE_TIME = 60_000;

export function searchRepositoriesQueryOptions(query: string) {
	return queryOptions({
		queryKey: queryKeys.searchRepositories(query),
		queryFn: () =>
			perfTime(`query searchRepositories "${query}"`, () =>
				searchRepositories({ data: { query } }),
			),
		staleTime: SEARCH_STALE_TIME,
	});
}

export function searchUsersQueryOptions(query: string) {
	return queryOptions({
		queryKey: queryKeys.searchUsers(query),
		queryFn: () =>
			perfTime(`query searchUsers "${query}"`, () =>
				searchUsers({ data: { query } }),
			),
		staleTime: SEARCH_STALE_TIME,
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

export function repositoryTagsQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoTags(repoId),
		queryFn: () =>
			perfTime(`query tags repo=${repoId}`, () =>
				getTags({ data: { repoId } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

/**
 * A thread's comments or timeline events, one `THREAD_PAGE_SIZE` page at a time
 * (oldest first): a thread can outgrow what one response may carry. A short
 * page is the last one.
 */
function threadPagesQueryOptions<T>(
	queryKey: readonly unknown[],
	fetchPage: (skip: number) => Promise<T[]>,
) {
	return infiniteQueryOptions({
		queryKey,
		queryFn: ({ pageParam }) => fetchPage(pageParam),
		initialPageParam: 0,
		getNextPageParam: (lastPage, pages) => {
			const next = pages.length * THREAD_PAGE_SIZE;
			return lastPage.length < THREAD_PAGE_SIZE || next > MAX_LIST_SKIP
				? undefined
				: next;
		},
		staleTime: DEFAULT_STALE_TIME,
	});
}

/**
 * The comments the viewer posted in this session, kept apart from the paged
 * query: later pages may still be unloaded, and refetching every page after
 * each post would cost a request per page. They render as a tail after the
 * thread (GitHub shows your new comment at the bottom), and drop out of it once
 * the paged query has loaded them.
 */
export function postedCommentsQueryOptions<C>(commentsKey: readonly unknown[]) {
	return queryOptions({
		queryKey: ["posted-comments", ...commentsKey] as const,
		queryFn: (): C[] => [],
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function addPostedComment<C>(
	queryClient: QueryClient,
	commentsKey: readonly unknown[],
	comment: C,
) {
	const { queryKey } = postedCommentsQueryOptions<C>(commentsKey);
	queryClient.setQueryData<C[]>(queryKey, (posted = []) => [
		...posted,
		comment,
	]);
	return queryClient.invalidateQueries({
		queryKey: commentsKey,
		refetchType: "none",
	});
}

export function timelineQueryOptions(repoId: number, number: number) {
	return threadPagesQueryOptions(queryKeys.timeline(repoId, number), (skip) =>
		getTimeline({ data: { repoId, number, skip } }),
	);
}

/**
 * One authoritative request for the three Git values the directory screen
 * renders together. This shares a cold R2 Git context rather than asking
 * independent server functions to rediscover refs and packs in parallel.
 */
export function repositoryTreePageQueryOptions({
	repoId,
	branchName,
	path = "",
}: {
	repoId: number;
	branchName: string;
	path?: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoTreePage(repoId, branchName, path),
		queryFn: () =>
			perfTime(
				`query tree page repo=${repoId} ${branchName}:${path || "/"}`,
				() => getTreePageData({ data: { repoId, branchName, path } }),
			),
		staleTime: DEFAULT_STALE_TIME,
	});
}

/** A directory's entries alone, for expanding the file tree. */
export function repositoryTreeEntriesQueryOptions({
	repoId,
	branchName,
	path = "",
}: {
	repoId: number;
	branchName: string;
	path?: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoTreeEntries(repoId, branchName, path),
		queryFn: () => getTreeEntries({ data: { repoId, branchName, path } }),
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
	depth = "full",
}: {
	repoId: number;
	branchName: string;
	path: string;
	limit?: number;
	/** "banner" for a latest-commit-only lookup (a shallower first walk). */
	depth?: "banner" | "full";
}) {
	return queryOptions({
		queryKey: queryKeys.repoFileHistory(repoId, branchName, path, limit, depth),
		queryFn: () =>
			perfTime(
				`query file history repo=${repoId} ${branchName}:${path} limit=${limit}`,
				() =>
					getFileHistory({
						data: { repoId, branchName, path, limit, depth },
					}),
			),
		staleTime: LONG_LIVED_STALE_TIME,
		gcTime: LONG_LIVED_GC_TIME,
	});
}

export function repositoryBlameQueryOptions({
	repoId,
	branchName,
	path,
}: {
	repoId: number;
	branchName: string;
	path: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoBlame(repoId, branchName, path),
		queryFn: () =>
			perfTime(`query blame repo=${repoId} ${branchName}:${path}`, () =>
				getBlame({ data: { repoId, branchName, path } }),
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

/**
 * A branch's tip commit — one cache entry shared by CommitSummaryBar and the
 * branch-update banner's polling, so both always agree (the banner adds
 * `refetchInterval` to this same query).
 */
export function repositoryLatestCommitQueryOptions({
	repoId,
	branchName,
}: {
	repoId: number;
	branchName: string;
}) {
	return repositoryCommitsQueryOptions({ repoId, branchName, limit: 1 });
}

/**
 * A commit by branch, tag, `HEAD` or (abbreviated) sha. Only a full sha is
 * immutable; any other revision can move, so it refetches like other lists.
 */
export function repositoryCommitQueryOptions({
	repoId,
	rev,
}: {
	repoId: number;
	rev: string;
}) {
	const immutable = /^[0-9a-f]{40}$/i.test(rev);
	return queryOptions({
		queryKey: queryKeys.repoCommit(repoId, rev),
		queryFn: () => getCommit({ data: { repoId, rev } }),
		staleTime: immutable ? IMMUTABLE_STALE_TIME : DEFAULT_STALE_TIME,
		gcTime: immutable ? IMMUTABLE_GC_TIME : undefined,
	});
}

/** A commit's comments, oldest first, one `THREAD_PAGE_SIZE` page at a time. */
export function commitCommentsQueryOptions(repoId: number, sha: string) {
	return infiniteQueryOptions({
		queryKey: queryKeys.commitComments(repoId, sha),
		queryFn: ({ pageParam }) =>
			getCommitComments({ data: { repoId, sha, skip: pageParam } }),
		initialPageParam: 0,
		getNextPageParam: (lastPage, pages) => {
			const next = pages.length * THREAD_PAGE_SIZE;
			return lastPage.comments.length < THREAD_PAGE_SIZE || next > MAX_LIST_SKIP
				? undefined
				: next;
		},
		staleTime: DEFAULT_STALE_TIME,
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

export function assignableUsersQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoAssignable(repoId),
		queryFn: () => getAssignableUsers({ data: { repoId } }),
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

export function repositoryLabelsQueryOptions(repoId: number) {
	return queryOptions({
		queryKey: queryKeys.repoLabels(repoId),
		queryFn: () => getLabels({ data: { repoId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryMilestonesQueryOptions(
	repoId: number,
	state: "open" | "closed" | "all" = "open",
) {
	return queryOptions({
		queryKey: queryKeys.repoMilestoneList(repoId, state),
		queryFn: () => getMilestones({ data: { repoId, state } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function milestoneQueryOptions(repoId: number, number: number) {
	return queryOptions({
		queryKey: queryKeys.repoMilestone(repoId, number),
		queryFn: () => getMilestoneByNumber({ data: { repoId, number } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function milestoneThreadsQueryOptions(
	repoId: number,
	number: number,
	state: "open" | "closed",
) {
	return queryOptions({
		queryKey: queryKeys.repoMilestoneThreads(repoId, number, state),
		queryFn: () => getMilestoneThreads({ data: { repoId, number, state } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

/** Reaction rollups for a thread and all its comments: one request per page. */
export function threadReactionsQueryOptions(repoId: number, number: number) {
	return queryOptions({
		queryKey: queryKeys.threadReactions(repoId, number),
		queryFn: () => getThreadReactions({ data: { repoId, number } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function threadSubscriptionQueryOptions(repoId: number, number: number) {
	return queryOptions({
		queryKey: queryKeys.threadSubscription(repoId, number),
		queryFn: () => getThreadSubscription({ data: { repoId, number } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function notificationsQueryOptions(filter: {
	all: boolean;
	participating: boolean;
	page: number;
}) {
	return queryOptions({
		queryKey: queryKeys.notifications(filter),
		queryFn: () => getNotifications({ data: filter }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

/** The header badge; refreshed every minute while a tab is open. */
export function unreadNotificationCountQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.unreadNotificationCount,
		queryFn: () => getUnreadNotificationCount(),
		staleTime: 30_000,
		refetchInterval: 60_000,
	});
}

export function issueByNumberQueryOptions({
	owner,
	name,
	number,
}: {
	owner: string;
	name: string;
	number: number;
}) {
	return queryOptions({
		queryKey: queryKeys.issueByNumber(owner, name, number),
		queryFn: () => getIssueByNumber({ data: { owner, name, number } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function issueCommentsQueryOptions(issueId: number) {
	return threadPagesQueryOptions(queryKeys.issueComments(issueId), (skip) =>
		getComments({ data: { issueId, skip } }),
	);
}

export function pullRequestByNumberQueryOptions({
	owner,
	name,
	number,
}: {
	owner: string;
	name: string;
	number: number;
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequestByNumber(owner, name, number),
		queryFn: () => getPullRequestByNumber({ data: { owner, name, number } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function pullRequestCommentsQueryOptions(prId: number) {
	return threadPagesQueryOptions(queryKeys.pullRequestComments(prId), (skip) =>
		getComments({ data: { pullRequestId: prId, skip } }),
	);
}

/** A PR's Commits tab; the head branch moves, so it follows the diff's freshness. */
export function pullRequestCommitsQueryOptions({
	prId,
	autoRefresh = false,
}: {
	prId: number;
	autoRefresh?: boolean;
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequestCommits(prId),
		queryFn: () => getPullRequestCommits({ data: { prId } }),
		staleTime: autoRefresh ? DEFAULT_STALE_TIME : LONG_LIVED_STALE_TIME,
		gcTime: autoRefresh ? undefined : LONG_LIVED_GC_TIME,
		refetchOnWindowFocus: autoRefresh,
		refetchInterval: autoRefresh ? 20_000 : false,
	});
}

/**
 * A PR's diff is keyed by branch names, which move: loaded once by default;
 * `autoRefresh` (a per-repo setting) polls it so an open tab sees new pushes.
 */
export function pullRequestDiffQueryOptions({
	repoId,
	sourceBranch,
	targetBranch,
	autoRefresh = false,
}: {
	repoId: number;
	sourceBranch: string;
	targetBranch: string;
	autoRefresh?: boolean;
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequestDiff(repoId, sourceBranch, targetBranch),
		queryFn: () =>
			getBranchDiff({ data: { repoId, sourceBranch, targetBranch } }),
		staleTime: autoRefresh ? DEFAULT_STALE_TIME : LONG_LIVED_STALE_TIME,
		gcTime: autoRefresh ? undefined : LONG_LIVED_GC_TIME,
		refetchOnWindowFocus: autoRefresh,
		refetchInterval: autoRefresh ? 20_000 : false,
	});
}

/** The compare page: refs move, so it's short-lived like the default. */
export function repositoryComparisonQueryOptions({
	repoId,
	base,
	head,
	separator = "...",
}: {
	repoId: number;
	base: string;
	head: string;
	separator?: "..." | "..";
}) {
	return queryOptions({
		queryKey: queryKeys.comparison(repoId, base, head, separator),
		queryFn: () => getComparison({ data: { repoId, base, head, separator } }),
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

export function pullRequestReviewThreadsQueryOptions(prId: number) {
	return queryOptions({
		queryKey: queryKeys.pullRequestReviewThreads(prId),
		queryFn: () => getPullRequestReviewThreads({ data: { prId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function pullRequestPendingReviewQueryOptions(prId: number) {
	return queryOptions({
		queryKey: queryKeys.pullRequestPendingReview(prId),
		queryFn: () => getMyPendingReview({ data: { prId } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

/**
 * The issues list filtered by a GitHub query string (`?q=`), parsed on the
 * server with `#/lib/search-query`. The query string is the cache key, so
 * back/forward between filters is instant.
 */
export function repositoryIssueSearchQueryOptions({
	repoId,
	query,
}: {
	repoId: number;
	query: string;
}) {
	return queryOptions({
		queryKey: queryKeys.repoIssueSearch(repoId, query),
		queryFn: () => getIssues({ data: { repoId, query } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export function repositoryPullRequestSearchQueryOptions({
	repoId,
	query,
}: {
	repoId: number;
	query: string;
}) {
	return queryOptions({
		queryKey: queryKeys.pullRequestSearch(repoId, query),
		queryFn: () => getPullRequests({ data: { repoId, query } }),
		staleTime: DEFAULT_STALE_TIME,
	});
}

export const assignedThreadsQueryOptions = () =>
	queryOptions({
		queryKey: queryKeys.assignedThreads,
		queryFn: () => getAssignedThreads(),
	});
