/**
 * Tests for query-options.ts's *QueryOptions builders: queryFn wiring (calls
 * the right server function with the right args) and the staleTime/gcTime/
 * refetch config that determines cache/invalidation behavior. queryKeys
 * themselves are covered in query-options.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-session", () => ({ getSession: vi.fn(() => "session") }));
vi.mock("@/lib/perf-log", () => ({
	perfTime: (_label: string, fn: () => unknown) => fn(),
}));

const serverFnMocks = {
	getUserRepositories: vi.fn(() => "user-repos"),
	getUserActivity: vi.fn(() => "user-activity"),
	getUserProfile: vi.fn(() => "user-profile"),
	searchRepositories: vi.fn(() => "search-repos"),
	searchUsers: vi.fn(() => "search-users"),
	getRepositoryByName: vi.fn(() => "repo-by-name"),
	getBranches: vi.fn(() => "branches"),
	listFiles: vi.fn(() => "files"),
	getFile: vi.fn(() => "file"),
	getFileHistory: vi.fn(() => "file-history"),
	getCommits: vi.fn(() => "commits"),
	getCommit: vi.fn(() => "commit"),
	getCommitDiff: vi.fn(() => "commit-diff"),
	getLastCommits: vi.fn(() => "last-commits"),
	getIssueNumbers: vi.fn(() => "issue-numbers"),
	getPullRequestNumbers: vi.fn(() => "pr-numbers"),
	getIssues: vi.fn(() => "issues"),
	getIssue: vi.fn(() => "issue"),
	getComments: vi.fn(() => "comments"),
	getPullRequests: vi.fn(() => "prs"),
	getPullRequest: vi.fn(() => "pr"),
	getBranchDiff: vi.fn(() => "branch-diff"),
	getCollaborators: vi.fn(() => "collaborators"),
};

vi.mock("@/server/repositories", () => ({
	getUserRepositories: serverFnMocks.getUserRepositories,
	getRepositoryByName: serverFnMocks.getRepositoryByName,
	getCollaborators: serverFnMocks.getCollaborators,
}));
vi.mock("@/server/search", () => ({
	getUserActivity: serverFnMocks.getUserActivity,
	searchRepositories: serverFnMocks.searchRepositories,
	searchUsers: serverFnMocks.searchUsers,
}));
vi.mock("@/server/users", () => ({
	getUserProfile: serverFnMocks.getUserProfile,
}));
vi.mock("@/server/files", () => ({
	getBranches: serverFnMocks.getBranches,
	listFiles: serverFnMocks.listFiles,
	getFile: serverFnMocks.getFile,
	getFileHistory: serverFnMocks.getFileHistory,
	getCommits: serverFnMocks.getCommits,
	getCommit: serverFnMocks.getCommit,
	getCommitDiff: serverFnMocks.getCommitDiff,
	getLastCommits: serverFnMocks.getLastCommits,
	getBranchDiff: serverFnMocks.getBranchDiff,
}));
vi.mock("@/server/issues", () => ({
	getIssueNumbers: serverFnMocks.getIssueNumbers,
	getIssues: serverFnMocks.getIssues,
	getIssue: serverFnMocks.getIssue,
}));
vi.mock("@/server/comments", () => ({
	getComments: serverFnMocks.getComments,
}));
vi.mock("@/server/pull-requests", () => ({
	getPullRequestNumbers: serverFnMocks.getPullRequestNumbers,
	getPullRequests: serverFnMocks.getPullRequests,
	getPullRequest: serverFnMocks.getPullRequest,
}));

const {
	authSessionQueryOptions,
	userRepositoriesQueryOptions,
	userActivityQueryOptions,
	userProfileQueryOptions,
	searchRepositoriesQueryOptions,
	searchUsersQueryOptions,
	repositoryByNameQueryOptions,
	repositoryBranchesQueryOptions,
	repositoryFilesQueryOptions,
	repositoryFileQueryOptions,
	repositoryFileHistoryQueryOptions,
	repositoryCommitsQueryOptions,
	repositoryLatestCommitQueryOptions,
	repositoryCommitQueryOptions,
	repositoryCommitDiffQueryOptions,
	repositoryLastCommitsQueryOptions,
	repositoryIssueNumbersQueryOptions,
	repositoryPullRequestNumbersQueryOptions,
	repositoryIssuesQueryOptions,
	issueQueryOptions,
	issueCommentsQueryOptions,
	repositoryPullRequestsQueryOptions,
	pullRequestQueryOptions,
	pullRequestCommentsQueryOptions,
	pullRequestDiffQueryOptions,
	repoCollaboratorsQueryOptions,
} = await import("../query-options");

describe("authSessionQueryOptions", () => {
	it("calls getSession and has a finite staleTime", () => {
		const opts = authSessionQueryOptions();
		expect(opts.queryFn?.({} as never)).toBe("session");
		expect(opts.staleTime).toBe(60_000);
	});
});

describe("userRepositoriesQueryOptions", () => {
	it("passes no userId when omitted", async () => {
		await userRepositoriesQueryOptions().queryFn?.({} as never);
		expect(serverFnMocks.getUserRepositories).toHaveBeenCalledWith({
			data: {},
		});
	});

	it("passes userId when given", async () => {
		await userRepositoriesQueryOptions("u1").queryFn?.({} as never);
		expect(serverFnMocks.getUserRepositories).toHaveBeenCalledWith({
			data: { userId: "u1" },
		});
	});
});

describe("userActivityQueryOptions", () => {
	it("defaults limit to 20", async () => {
		await userActivityQueryOptions({}).queryFn?.({} as never);
		expect(serverFnMocks.getUserActivity).toHaveBeenCalledWith({
			data: { limit: 20 },
		});
	});

	it("includes userId and custom limit when given", async () => {
		await userActivityQueryOptions({ userId: "u1", limit: 5 }).queryFn?.(
			{} as never,
		);
		expect(serverFnMocks.getUserActivity).toHaveBeenCalledWith({
			data: { userId: "u1", limit: 5 },
		});
	});
});

describe("userProfileQueryOptions", () => {
	it("calls getUserProfile with the username", async () => {
		await userProfileQueryOptions("octocat").queryFn?.({} as never);
		expect(serverFnMocks.getUserProfile).toHaveBeenCalledWith({
			data: { username: "octocat" },
		});
	});
});

describe("search query options", () => {
	it("searchRepositoriesQueryOptions calls searchRepositories", async () => {
		await searchRepositoriesQueryOptions("foo").queryFn?.({} as never);
		expect(serverFnMocks.searchRepositories).toHaveBeenCalledWith({
			data: { query: "foo" },
		});
	});

	it("searchUsersQueryOptions calls searchUsers", async () => {
		await searchUsersQueryOptions("bar").queryFn?.({} as never);
		expect(serverFnMocks.searchUsers).toHaveBeenCalledWith({
			data: { query: "bar" },
		});
	});
});

describe("repositoryByNameQueryOptions", () => {
	it("calls getRepositoryByName with owner/name", async () => {
		await repositoryByNameQueryOptions({
			owner: "acme",
			name: "widgets",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getRepositoryByName).toHaveBeenCalledWith({
			data: { owner: "acme", name: "widgets" },
		});
	});
});

describe("repositoryBranchesQueryOptions", () => {
	it("uses the long-lived stale/gc times", () => {
		const opts = repositoryBranchesQueryOptions(1);
		expect(opts.staleTime).toBe(10 * 60_000);
		expect(opts.gcTime).toBe(30 * 60_000);
	});
});

describe("file query options", () => {
	it("repositoryFilesQueryOptions defaults path to empty string", async () => {
		await repositoryFilesQueryOptions({
			repoId: 1,
			branchName: "main",
		}).queryFn?.({} as never);
		expect(serverFnMocks.listFiles).toHaveBeenCalledWith({
			data: { repoId: 1, branchName: "main", path: "" },
		});
	});

	it("repositoryFileQueryOptions calls getFile", async () => {
		await repositoryFileQueryOptions({
			repoId: 1,
			branchName: "main",
			path: "a.ts",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getFile).toHaveBeenCalledWith({
			data: { repoId: 1, branchName: "main", path: "a.ts" },
		});
	});

	it("repositoryFileHistoryQueryOptions defaults limit to 30 and passes maxDepth through", async () => {
		await repositoryFileHistoryQueryOptions({
			repoId: 1,
			branchName: "main",
			path: "a.ts",
			maxDepth: 5,
		}).queryFn?.({} as never);
		expect(serverFnMocks.getFileHistory).toHaveBeenCalledWith({
			data: {
				repoId: 1,
				branchName: "main",
				path: "a.ts",
				limit: 30,
				maxDepth: 5,
			},
		});
	});
});

describe("commit query options", () => {
	it("repositoryCommitsQueryOptions defaults limit/skip", async () => {
		await repositoryCommitsQueryOptions({
			repoId: 1,
			branchName: "main",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getCommits).toHaveBeenCalledWith({
			data: { repoId: 1, branchName: "main", limit: 50, skip: 0 },
		});
	});

	it("repositoryLatestCommitQueryOptions delegates to repositoryCommitsQueryOptions with limit 1", () => {
		const latest = repositoryLatestCommitQueryOptions({
			repoId: 1,
			branchName: "main",
		});
		const commits = repositoryCommitsQueryOptions({
			repoId: 1,
			branchName: "main",
			limit: 1,
		});
		expect(latest.queryKey).toEqual(commits.queryKey);
	});

	it("repositoryCommitQueryOptions is cached forever (immutable, content-addressed)", () => {
		const opts = repositoryCommitQueryOptions({ repoId: 1, commitSha: "a" });
		expect(opts.staleTime).toBe(Number.POSITIVE_INFINITY);
		expect(opts.gcTime).toBe(60 * 60_000);
	});

	it("repositoryCommitDiffQueryOptions is cached forever", () => {
		const opts = repositoryCommitDiffQueryOptions({
			repoId: 1,
			commitSha: "a",
		});
		expect(opts.staleTime).toBe(Number.POSITIVE_INFINITY);
	});

	it("repositoryLastCommitsQueryOptions calls getLastCommits", async () => {
		await repositoryLastCommitsQueryOptions({
			repoId: 1,
			branchName: "main",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getLastCommits).toHaveBeenCalledWith({
			data: { repoId: 1, branchName: "main", path: "" },
		});
	});
});

describe("issue/PR number query options", () => {
	it("repositoryIssueNumbersQueryOptions calls getIssueNumbers", async () => {
		await repositoryIssueNumbersQueryOptions(1).queryFn?.({} as never);
		expect(serverFnMocks.getIssueNumbers).toHaveBeenCalledWith({
			data: { repoId: 1 },
		});
	});

	it("repositoryPullRequestNumbersQueryOptions calls getPullRequestNumbers", async () => {
		await repositoryPullRequestNumbersQueryOptions(1).queryFn?.({} as never);
		expect(serverFnMocks.getPullRequestNumbers).toHaveBeenCalledWith({
			data: { repoId: 1 },
		});
	});
});

describe("issues/comments query options", () => {
	it("repositoryIssuesQueryOptions passes status through", async () => {
		await repositoryIssuesQueryOptions({ repoId: 1, status: "open" }).queryFn?.(
			{} as never,
		);
		expect(serverFnMocks.getIssues).toHaveBeenCalledWith({
			data: { repoId: 1, status: "open" },
		});
	});

	it("issueQueryOptions calls getIssue", async () => {
		await issueQueryOptions(5).queryFn?.({} as never);
		expect(serverFnMocks.getIssue).toHaveBeenCalledWith({
			data: { issueId: 5 },
		});
	});

	it("issueCommentsQueryOptions calls getComments with issueId", async () => {
		await issueCommentsQueryOptions(5).queryFn?.({} as never);
		expect(serverFnMocks.getComments).toHaveBeenCalledWith({
			data: { issueId: 5 },
		});
	});

	it("pullRequestCommentsQueryOptions calls getComments with pullRequestId", async () => {
		await pullRequestCommentsQueryOptions(9).queryFn?.({} as never);
		expect(serverFnMocks.getComments).toHaveBeenCalledWith({
			data: { pullRequestId: 9 },
		});
	});
});

describe("pull request query options", () => {
	it("repositoryPullRequestsQueryOptions omits status when 'all'", async () => {
		await repositoryPullRequestsQueryOptions({
			repoId: 1,
			status: "all",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getPullRequests).toHaveBeenCalledWith({
			data: { repoId: 1 },
		});
	});

	it("repositoryPullRequestsQueryOptions includes status otherwise", async () => {
		await repositoryPullRequestsQueryOptions({
			repoId: 1,
			status: "open",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getPullRequests).toHaveBeenCalledWith({
			data: { repoId: 1, status: "open" },
		});
	});

	it("pullRequestQueryOptions calls getPullRequest", async () => {
		await pullRequestQueryOptions(9).queryFn?.({} as never);
		expect(serverFnMocks.getPullRequest).toHaveBeenCalledWith({
			data: { prId: 9 },
		});
	});
});

describe("pullRequestDiffQueryOptions", () => {
	it("defaults to no auto-refresh: long-lived cache, no polling", () => {
		const opts = pullRequestDiffQueryOptions({
			repoId: 1,
			sourceBranch: "feature",
			targetBranch: "main",
		});
		expect(opts.staleTime).toBe(10 * 60_000);
		expect(opts.gcTime).toBe(30 * 60_000);
		expect(opts.refetchOnWindowFocus).toBe(false);
		expect(opts.refetchInterval).toBe(false);
	});

	it("autoRefresh=true polls every 20s with the default stale time", () => {
		const opts = pullRequestDiffQueryOptions({
			repoId: 1,
			sourceBranch: "feature",
			targetBranch: "main",
			autoRefresh: true,
		});
		expect(opts.staleTime).toBe(2 * 60_000);
		expect(opts.gcTime).toBeUndefined();
		expect(opts.refetchOnWindowFocus).toBe(true);
		expect(opts.refetchInterval).toBe(20_000);
	});

	it("calls getBranchDiff with source/target branches", async () => {
		await pullRequestDiffQueryOptions({
			repoId: 1,
			sourceBranch: "feature",
			targetBranch: "main",
		}).queryFn?.({} as never);
		expect(serverFnMocks.getBranchDiff).toHaveBeenCalledWith({
			data: { repoId: 1, sourceBranch: "feature", targetBranch: "main" },
		});
	});
});

describe("repoCollaboratorsQueryOptions", () => {
	it("calls getCollaborators with repoId", async () => {
		await repoCollaboratorsQueryOptions(1).queryFn?.({} as never);
		expect(serverFnMocks.getCollaborators).toHaveBeenCalledWith({
			data: { repoId: 1 },
		});
	});
});
