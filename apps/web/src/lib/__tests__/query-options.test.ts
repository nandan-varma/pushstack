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

	describe("repoFilesRoot", () => {
		// Uploads and merges invalidate only this root, so a branch-content key
		// outside it would serve a stale tree after the write.
		it("prefixes every key read from a branch's tree", () => {
			const root = queryKeys.repoFilesRoot(1);
			for (const key of [
				queryKeys.repoFile(1, "main", "README.md"),
				queryKeys.repoTreePage(1, "main", "src"),
				queryKeys.repoLastCommits(1, "main", "src"),
				queryKeys.repoFileHistory(1, "main", "README.md"),
			]) {
				expect(key.slice(0, root.length)).toEqual([...root]);
			}
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
				"files",
				"last-commits",
				"main",
				"",
			]);
		});
		it("includes path when given", () => {
			expect(queryKeys.repoLastCommits(1, "main", "src")).toEqual([
				"repos",
				1,
				"files",
				"last-commits",
				"main",
				"src",
			]);
		});
	});

	describe("repoFileHistory", () => {
		it("defaults limit and depth", () => {
			expect(queryKeys.repoFileHistory(1, "main", "file.ts")).toEqual([
				"repos",
				1,
				"files",
				"file-history",
				"main",
				"file.ts",
				30,
				"full",
			]);
		});
		it("uses the given depth", () => {
			expect(
				queryKeys.repoFileHistory(1, "main", "file.ts", 10, "banner"),
			).toEqual([
				"repos",
				1,
				"files",
				"file-history",
				"main",
				"file.ts",
				10,
				"banner",
			]);
		});
	});

	describe("repoIssueSearch / pullRequestSearch", () => {
		it("keys by the query string", () => {
			expect(queryKeys.repoIssueSearch(1, "is:open label:bug")).toEqual([
				"repos",
				1,
				"issues",
				"search",
				"is:open label:bug",
			]);
			expect(queryKeys.pullRequestSearch(1, "is:merged")).toEqual([
				"repos",
				1,
				"pull-requests",
				"search",
				"is:merged",
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
				queryKeys.repoTreePage(repoId, "main"),
				queryKeys.repoCommits(repoId, "main"),
				queryKeys.repoIssueSearch(repoId, "is:open"),
				queryKeys.pullRequestSearch(repoId, "is:open"),
				queryKeys.repoCollaborators(repoId),
			];
			for (const key of keys) {
				expect(key[0]).toBe("repos");
				expect(key[1]).toBe(repoId);
			}
		});
	});
});
