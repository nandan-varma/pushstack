import { describe, expect, it } from "vitest";
import { isValidGitPath, parseGitUrl } from "#/lib/git-url-parser";

const BASE = "http://localhost:3000";

describe("parseGitUrl", () => {
	it("parses info/refs for upload-pack", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/myrepo.git/info/refs?service=git-upload-pack`,
		);
		expect(result).toMatchObject({
			owner: "alice",
			repo: "myrepo",
			service: "git-upload-pack",
			isInfoRefs: true,
		});
	});

	it("parses info/refs for receive-pack", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/myrepo.git/info/refs?service=git-receive-pack`,
		);
		expect(result).toMatchObject({
			owner: "alice",
			repo: "myrepo",
			service: "git-receive-pack",
			isInfoRefs: true,
		});
	});

	it("parses upload-pack POST path", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/myrepo.git/git-upload-pack`,
		);
		expect(result).toMatchObject({
			owner: "alice",
			repo: "myrepo",
			service: "git-upload-pack",
			isInfoRefs: false,
		});
	});

	it("parses receive-pack POST path", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/myrepo.git/git-receive-pack`,
		);
		expect(result).toMatchObject({
			owner: "alice",
			repo: "myrepo",
			service: "git-receive-pack",
			isInfoRefs: false,
		});
	});

	it("strips .git extension from repo name", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/owner/repo.git/git-upload-pack`,
		);
		expect(result?.repo).toBe("repo");
	});

	it("works without .git extension", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/owner/repo/info/refs?service=git-upload-pack`,
		);
		expect(result?.repo).toBe("repo");
		expect(result?.isInfoRefs).toBe(true);
	});

	it("returns null for missing owner/repo", () => {
		expect(parseGitUrl(`${BASE}/api/git/`)).toBeNull();
		expect(parseGitUrl(`${BASE}/api/git/owner`)).toBeNull();
	});

	it("returns null for invalid URL", () => {
		expect(parseGitUrl("not-a-url")).toBeNull();
	});

	it("returns undefined service for info/refs with unknown service param", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/repo.git/info/refs?service=git-unknown`,
		);
		expect(result?.service).toBeUndefined();
		expect(result?.isInfoRefs).toBe(true);
	});

	it("preserves rawPath", () => {
		const result = parseGitUrl(
			`${BASE}/api/git/alice/repo.git/git-upload-pack`,
		);
		expect(result?.rawPath).toBe("/api/git/alice/repo.git/git-upload-pack");
	});
});

describe("isValidGitPath", () => {
	it("accepts valid owner/repo", () => {
		expect(isValidGitPath("alice/myrepo")).toBe(true);
		expect(isValidGitPath("org-name/repo_name")).toBe(true);
	});

	it("rejects single segment", () => {
		expect(isValidGitPath("alice")).toBe(false);
	});

	it("rejects segments with special characters", () => {
		expect(isValidGitPath("alice/repo.git")).toBe(false);
		expect(isValidGitPath("alice/repo name")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isValidGitPath("")).toBe(false);
	});
});
