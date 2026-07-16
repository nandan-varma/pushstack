import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getCloneUrl,
	getGitBaseUrl,
	getSetupInstructions,
	isValidGitRef,
	sanitizeRepoName,
} from "../git-utils";

describe("getGitBaseUrl", () => {
	it("returns window.location.origin when window is defined", () => {
		expect(getGitBaseUrl()).toBe("http://localhost:3000");
	});
});

describe("getCloneUrl", () => {
	it("returns HTTPS clone URL", () => {
		const url = getCloneUrl("alice", "my-repo");
		expect(url).toBe("http://localhost:3000/api/git/alice/my-repo.git");
	});

	it("throws for unsupported protocol", () => {
		expect(() => getCloneUrl("alice", "my-repo", "ssh" as "https")).toThrow(
			"Protocol ssh not supported yet",
		);
	});
});

describe("getSetupInstructions", () => {
	it("returns instructions for new repo, existing repo, and import", () => {
		const instructions = getSetupInstructions(
			"alice",
			"my-repo",
			"https://example.com/alice/my-repo.git",
		);

		expect(instructions.newRepo).toContain("git init");
		expect(instructions.newRepo).toContain("my-repo");
		expect(instructions.newRepo).toContain(
			"https://example.com/alice/my-repo.git",
		);

		expect(instructions.existingRepo).toContain("git remote add origin");
		expect(instructions.existingRepo).toContain(
			"https://example.com/alice/my-repo.git",
		);

		expect(instructions.importRepo).toContain("git clone");
		expect(instructions.importRepo).toContain(
			"https://example.com/alice/my-repo.git",
		);
	});
});

describe("isValidGitRef", () => {
	it("accepts valid branch names", () => {
		expect(isValidGitRef("main")).toBe(true);
		expect(isValidGitRef("feature/my-branch")).toBe(true);
		expect(isValidGitRef("release-1.0")).toBe(true);
		expect(isValidGitRef("refs/heads/main")).toBe(true);
		expect(isValidGitRef("HEAD")).toBe(true);
	});

	it("rejects invalid refs", () => {
		expect(isValidGitRef("")).toBe(false);
		expect(isValidGitRef("..")).toBe(false);
		expect(isValidGitRef("branch..name")).toBe(false);
		expect(isValidGitRef("trailing-slash/")).toBe(false);
		expect(isValidGitRef(" spaces ")).toBe(false);
	});

	it("rejects refs exceeding 255 characters", () => {
		expect(isValidGitRef("a".repeat(256))).toBe(false);
		expect(isValidGitRef("a".repeat(255))).toBe(true);
	});
});

describe("sanitizeRepoName", () => {
	it("lowercases the name", () => {
		expect(sanitizeRepoName("MyRepo")).toBe("myrepo");
	});

	it("replaces invalid characters with hyphens", () => {
		expect(sanitizeRepoName("my repo!")).toBe("my-repo");
	});

	it("collapses multiple hyphens", () => {
		expect(sanitizeRepoName("my   repo")).toBe("my-repo");
	});

	it("removes leading and trailing hyphens", () => {
		expect(sanitizeRepoName("-hello-")).toBe("hello");
	});

	it("truncates to 100 characters", () => {
		const long = "a".repeat(150);
		expect(sanitizeRepoName(long)).toHaveLength(100);
	});

	it("preserves underscores and digits", () => {
		expect(sanitizeRepoName("my_repo_123")).toBe("my_repo_123");
	});
});
