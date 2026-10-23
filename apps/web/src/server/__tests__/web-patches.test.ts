/**
 * @vitest-environment node
 *
 * The web origin's plain-text `.diff`/`.patch` URLs for commits, comparisons
 * and pull requests, the compare page's server function, and the compare
 * spec parser.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { call, mintToken, post } = await import("../../test/api-client");
const { createBranch, createCommit } = await import("../git-write");
const { serveCommitPatch, serveComparePatch, servePullPatch, webPatchCaps } =
	await import("../web-patches");
const { getComparison } = await import("../files");
const { findRepositoryByName } = await import("../repository-lookup");
const { parseCompareSpec, splitPatchSuffix } = await import(
	"#/lib/compare-spec"
);

let alice: string;
let feature1: string;
let feature2: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call(
		"/user/repos",
		post(alice, { name: "secret", auto_init: true, private: true }),
	);
	await createBranch("alice", "proj", "feature", "main");
	feature1 = await createCommit("alice", "proj", {
		branch: "feature",
		message: "Add notes\n\nWith a body.",
		files: [{ path: "notes.txt", content: "one\ntwo\n" }],
		author: { name: "Robot", email: "robot@example.org" },
	});
	feature2 = await createCommit("alice", "proj", {
		branch: "feature",
		message: "Edit notes",
		files: [{ path: "notes.txt", content: "one\nTWO\n" }],
		author: { name: "Robot", email: "robot@example.org" },
	});
	await call(
		"/repos/alice/proj/pulls",
		post(alice, { title: "Notes", head: "feature", base: "main" }),
	);
});

describe("compare spec", () => {
	it("parses GitHub's forms", () => {
		expect(parseCompareSpec("main...feature", "alice")).toEqual({
			base: "main",
			head: "feature",
			separator: "...",
		});
		expect(parseCompareSpec("main..feature", "alice")?.separator).toBe("..");
		expect(parseCompareSpec("feature", "alice")?.base).toBeNull();
		expect(parseCompareSpec("ALICE:main...alice:feature", "alice")).toEqual({
			base: "main",
			head: "feature",
			separator: "...",
		});
		expect(parseCompareSpec("bob:main...feature", "alice")).toBeNull();
		expect(parseCompareSpec("...feature", "alice")).toBeNull();
		expect(splitPatchSuffix("abc.diff")).toEqual({
			name: "abc",
			format: "diff",
		});
		expect(splitPatchSuffix("1.patch")?.format).toBe("patch");
		expect(splitPatchSuffix("abc")).toBeNull();
	});
});

describe("plain-text URLs", () => {
	it("serves a commit's diff and patch", async () => {
		const diff = await serveCommitPatch("alice", "proj", feature2, "diff");
		expect(diff.status).toBe(200);
		expect(diff.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(diff.headers.get("x-content-type-options")).toBe("nosniff");
		const text = await diff.text();
		expect(text).toContain("diff --git a/notes.txt b/notes.txt");
		expect(text).toContain("+TWO");

		const patch = await (
			await serveCommitPatch("alice", "proj", feature2, "patch")
		).text();
		expect(patch).toMatch(new RegExp(`^From ${feature2} `));
		expect(patch).toContain("Subject: [PATCH] Edit notes");
	});

	it("serves a comparison, oldest commit first", async () => {
		const diff = await (
			await serveComparePatch("alice", "proj", "main...feature", "diff")
		).text();
		expect(diff).toContain("+TWO");
		expect(diff).not.toContain("+two");

		const patch = await (
			await serveComparePatch("alice", "proj", "feature", "patch")
		).text();
		expect(patch.indexOf(feature1)).toBeLessThan(patch.indexOf(feature2));
		expect(patch).toContain("Subject: [PATCH 1/2] Add notes");
		expect(patch).toContain("Subject: [PATCH 2/2] Edit notes");
	});

	it("serves a pull request's diff and patch", async () => {
		const diff = await servePullPatch("alice", "proj", "1", "diff");
		expect(diff.status).toBe(200);
		expect(await diff.text()).toContain("+TWO");
		const patch = await (
			await servePullPatch("alice", "proj", "1", "patch")
		).text();
		expect(patch).toContain("[PATCH 2/2] Edit notes");
	});

	it("is 404 for unknown or unsafe names", async () => {
		const statuses = await Promise.all([
			serveCommitPatch("alice", "proj", "0".repeat(40), "diff"),
			serveCommitPatch("alice", "proj", "../../x", "diff"),
			serveComparePatch("alice", "proj", "main...nope", "diff"),
			serveComparePatch("alice", "proj", "bob:main...feature", "diff"),
			servePullPatch("alice", "proj", "99", "diff"),
			servePullPatch("alice", "proj", "1x", "diff"),
			serveCommitPatch("alice", "missing", "main", "diff"),
		]);
		expect(statuses.map((r) => r.status)).toEqual([
			404, 404, 404, 404, 404, 404, 404,
		]);
	});

	it("serves a two-dot comparison as a direct diff", async () => {
		const response = await serveComparePatch(
			"alice",
			"proj",
			"main..feature",
			"diff",
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("+TWO");
		const reverse = await (
			await serveComparePatch("alice", "proj", "feature..main", "diff")
		).text();
		expect(reverse).toContain("-TWO");
		expect(reverse).toContain("+++ /dev/null");
	});

	it("refuses bodies over the cap with 406", async () => {
		const saved = webPatchCaps.maxBytes;
		try {
			const full = await (
				await serveComparePatch("alice", "proj", "main...feature", "patch")
			).text();
			webPatchCaps.maxBytes = full.length - 1;
			for (const response of [
				await serveComparePatch("alice", "proj", "main...feature", "patch"),
				await servePullPatch("alice", "proj", "1", "patch"),
			]) {
				expect(response.status).toBe(406);
				expect(response.headers.get("content-type")).toBe(
					"text/plain; charset=utf-8",
				);
			}
			webPatchCaps.maxBytes = full.length;
			const exact = await serveComparePatch(
				"alice",
				"proj",
				"main...feature",
				"patch",
			);
			expect(exact.status).toBe(200);
			expect(exact.headers.get("content-length")).toBe(String(full.length));
			expect(await exact.text()).toBe(full);
		} finally {
			webPatchCaps.maxBytes = saved;
		}
	});

	it("hides private repositories from readers without access", async () => {
		await createBranch("alice", "secret", "topic", "main");
		await createCommit("alice", "secret", {
			branch: "topic",
			message: "Secret change",
			files: [{ path: "s.txt", content: "s\n" }],
			author: { name: "Robot", email: "robot@example.org" },
		});
		await call(
			"/repos/alice/secret/pulls",
			post(alice, { title: "Secret", head: "topic", base: "main" }),
		);
		const all = () =>
			Promise.all([
				serveCommitPatch("alice", "secret", "main", "diff"),
				serveComparePatch("alice", "secret", "main...topic", "diff"),
				servePullPatch("alice", "secret", "1", "patch"),
			]).then((responses) => responses.map((r) => r.status));
		signOut();
		expect(await all()).toEqual([404, 404, 404]);
		signIn(users.bob);
		expect(await all()).toEqual([404, 404, 404]);
		signIn(users.alice);
		expect(await all()).toEqual([200, 200, 200]);
		signOut();
	});
});

describe("compare page data", () => {
	it("lists commits ahead and the three-dot diff", async () => {
		const repo = await findRepositoryByName("alice", "proj");
		const result = await getComparison({
			data: { repoId: repo?.id ?? 0, base: "main", head: "feature" },
		});
		expect(result.status).toBe("ahead");
		expect(result.aheadBy).toBe(2);
		expect(result.behindBy).toBe(0);
		expect(result.commits.map((c) => c.sha)).toEqual([feature1, feature2]);
		expect(result.diff.files.map((f) => f.path)).toEqual(["notes.txt"]);
	});

	it("rejects unsafe refs", async () => {
		const repo = await findRepositoryByName("alice", "proj");
		await expect(
			getComparison({
				data: { repoId: repo?.id ?? 0, base: "../x", head: "feature" },
			}),
		).rejects.toThrow();
	});
});
