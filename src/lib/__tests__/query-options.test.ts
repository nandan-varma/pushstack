/**
 * Tests for query-options.ts — query key factories and query option builders.
 * Keys must be deterministic, hierarchical, and correctly scoped so that
 * invalidation (e.g. queryClient.invalidateQueries({ queryKey: ["repos", id] }))
 * targets exactly the right subset of cached queries.
 */
import { describe, expect, it } from "vitest";
import { queryKeys } from "../query-options";

describe("queryKeys", () => {
	describe("auth session", () => {
		it("returns stable auth/session key", () => {
			expect(queryKeys.authSession).toEqual(["auth", "session"]);
		});
	});

	describe("userRepositories", () => {
		it("uses 'self' when no userId given", () => {
			expect(queryKeys.userRepositories()).toEqual([
				"repositories",
				"user",
				"self",
			]);
		});
		it("includes userId when provided", () => {
			expect(queryKeys.userRepositories("u1")).toEqual([
				"repositories",
				"user",
				"u1",
			]);
		});
	});

	describe("repositoryByName", () => {
		it("encodes owner and name", () => {
			expect(queryKeys.repositoryByName("acme", "repo")).toEqual([
				"repositories",
				"by-name",
				"acme",
				"repo",
			]);
		});
	});

	describe("repoBranches", () => {
		it("scopes by repoId", () => {
			expect(queryKeys.repoBranches(42)).toEqual(["repos", 42, "branches"]);
		});
	});

	describe("repoFiles", () => {
		it("defaults path to empty string", () => {
			expect(queryKeys.repoFiles(1, "main")).toEqual([
				"repos",
				1,
				"files",
				"main",
				"",
			]);
		});
		it("includes path when given", () => {
			expect(queryKeys.repoFiles(1, "main", "src/index.ts")).toEqual([
				"repos",
				1,
				"files",
				"main",
				"src/index.ts",
			]);
		});
	});

	describe("repoFile", () => {
		it("includes branch and path", () => {
			expect(queryKeys.repoFile(1, "main", "README.md")).toEqual([
				"repos",
				1,
				"files",
				"content",
				"main",
				"README.md",
			]);
		});
	});

	describe("repoCommits", () => {
		it("defaults limit and skip", () => {
			expect(queryKeys.repoCommits(1, "main")).toEqual([
				"repos",
				1,
				"commits",
				"main",
				50,
				0,
			]);
		});
		it("includes custom limit and skip", () => {
			expect(queryKeys.repoCommits(1, "main", 10, 5)).toEqual([
				"repos",
				1,
				"commits",
				"main",
				10,
				5,
			]);
		});
	});

	describe("repoCommit", () => {
		it("uses commit SHA", () => {
			expect(queryKeys.repoCommit(1, "abc1234")).toEqual([
				"repos",
				1,
				"commit",
				"abc1234",
			]);
		});
	});

	describe("repoLastCommits", () => {
		it("defaults path to empty", () => {
			expect(queryKeys.repoLastCommits(1, "main")).toEqual([
				"repos",
				1,
				"last-commits",
				"main",
				"",
			]);
		});
		it("includes path when given", () => {
			expect(queryKeys.repoLastCommits(1, "main", "src")).toEqual([
				"repos",
				1,
				"last-commits",
				"main",
				"src",
			]);
		});
	});

	describe("repoFileHistory", () => {
		it("defaults limit and uses 'default' for undefined maxDepth", () => {
			expect(queryKeys.repoFileHistory(1, "main", "file.ts")).toEqual([
				"repos",
				1,
				"file-history",
				"main",
				"file.ts",
				30,
				"default",
			]);
		});
		it("uses actual maxDepth when provided", () => {
			expect(queryKeys.repoFileHistory(1, "main", "file.ts", 10, 3)).toEqual([
				"repos",
				1,
				"file-history",
				"main",
				"file.ts",
				10,
				3,
			]);
		});
	});

	describe("repoIssues", () => {
		it("includes status filter", () => {
			expect(queryKeys.repoIssues(1, "open")).toEqual([
				"repos",
				1,
				"issues",
				"open",
			]);
			expect(queryKeys.repoIssues(1, "all")).toEqual([
				"repos",
				1,
				"issues",
				"all",
			]);
		});
	});

	describe("pullRequests", () => {
		it("includes status filter", () => {
			expect(queryKeys.pullRequests(1, "merged")).toEqual([
				"repos",
				1,
				"pull-requests",
				"merged",
			]);
		});
	});

	describe("pullRequestDiff", () => {
		it("keys by source and target branch", () => {
			expect(queryKeys.pullRequestDiff(1, "feature", "main")).toEqual([
				"repos",
				1,
				"pull-request-diff",
				"feature",
				"main",
			]);
		});
	});

	describe("hierarchical invalidation", () => {
		it("repo-level keys start with ['repos', repoId, ...]", () => {
			const repoId = 7;
			const keys = [
				queryKeys.repoBranches(repoId),
				queryKeys.repoFiles(repoId, "main"),
				queryKeys.repoCommits(repoId, "main"),
				queryKeys.repoIssues(repoId, "open"),
				queryKeys.pullRequests(repoId, "open"),
				queryKeys.repoCollaborators(repoId),
			];
			for (const key of keys) {
				expect(key[0]).toBe("repos");
				expect(key[1]).toBe(repoId);
			}
		});

		it("issue keys are separate from repo keys", () => {
			const issueKey = queryKeys.issue(1);
			expect(issueKey[0]).toBe("issues");
		});

		it("PR keys are separate from repo keys", () => {
			const prKey = queryKeys.pullRequest(1);
			expect(prKey[0]).toBe("pull-requests");
		});
	});
});
