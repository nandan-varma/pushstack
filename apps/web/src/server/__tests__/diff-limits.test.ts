/** @vitest-environment node */

import { MAX_DIFF_FILES } from "git-fs-s3/ops";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
const { createUsers, signIn } = await import("../../test/app-harness");
const { mintToken, call, post, BASE } = await import("../../test/api-client");
const { handleApiRequest } = await import("../api");
const gitRead = await import("../git-read");
const { apiCaps } = await import("../api/caps");
const { createCommit, createBranch } = await import("../git-write");
const { createPullRequest } = await import("../pull-requests");
const { serveCommitPatch, serveComparePatch, servePullPatch } = await import(
	"../web-patches"
);
let wide: string;
beforeAll(async () => {
	const users = await createUsers("alice");
	const token = await mintToken(users.alice, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(token, { name: "proj", auto_init: true }),
	);
	signIn(users.alice);
	await createBranch("alice", "proj", "wide", "main");
	wide = await createCommit("alice", "proj", {
		branch: "wide",
		message: "wide",
		files: Array.from({ length: MAX_DIFF_FILES + 1 }, (_, i) => ({
			path: `file-${i}`,
			content: "",
		})),
		author: { name: "Tester", email: "test@invalid.test" },
	});
	await createPullRequest({
		data: {
			repoId: created.body.id,
			title: "Wide",
			sourceBranchName: "wide",
			targetBranchName: "main",
		},
	});
	await createBranch("alice", "proj", "small", "main");
	for (let i = 0; i < 2; i++)
		await createCommit("alice", "proj", {
			branch: "small",
			message: `small ${i}`,
			files: [{ path: "file", content: `line ${i}\n` }],
			author: { name: "Tester", email: "test@invalid.test" },
		});
});
it("returns explicit 406 on REST commit, compare and PR Files paths", async () => {
	for (const path of [
		`/commits/${wide}`,
		"/compare/main...wide",
		"/pulls/1/files",
	]) {
		const response = await call(`/repos/alice/proj${path}`);
		expect(response.status).toBe(406);
		expect(response.body.message).toContain("3000 files");
	}
});
it("returns 406 on all web diff/patch paths", async () => {
	for (const format of ["diff", "patch"] as const) {
		const responses = [
			await serveCommitPatch("alice", "proj", wide, format),
			await serveComparePatch("alice", "proj", "main...wide", format),
			await servePullPatch("alice", "proj", "1", format),
		];
		for (const response of responses) {
			expect(response.status).toBe(406);
			expect(await response.text()).toContain("Clone the repository");
		}
	}
});
it("caps aggregate comparison patches across commits", async () => {
	const url = `${BASE}/repos/alice/proj/compare/main...small`;
	const request = () =>
		new Request(url, { headers: { accept: "application/vnd.github.patch" } });
	let active = 0;
	let maxActive = 0;
	const original = gitRead.getCommitDiff;
	const diffCalls = vi
		.spyOn(gitRead, "getCommitDiff")
		.mockImplementation(async (...args) => {
			active++;
			maxActive = Math.max(maxActive, active);
			try {
				return await original(...args);
			} finally {
				active--;
			}
		});
	const full = await handleApiRequest(request());
	expect(full.status).toBe(200);
	expect(maxActive).toBe(1);
	diffCalls.mockRestore();
	const text = await full.text();
	expect(text).toContain("[PATCH 1/2]");
	expect(text).toContain("[PATCH 2/2]");
	const before = apiCaps.diffMediaBytes;
	try {
		apiCaps.diffMediaBytes = new TextEncoder().encode(text).byteLength - 1;
		expect((await handleApiRequest(request())).status).toBe(406);
		apiCaps.diffMediaBytes++;
		const exact = await handleApiRequest(request());
		expect(exact.status).toBe(200);
		expect(await exact.text()).toBe(text);
	} finally {
		apiCaps.diffMediaBytes = before;
	}
});

it("refuses an oversized commit diff, commit patch and compare diff with 406", async () => {
	const media = (path: string, accept: string) =>
		handleApiRequest(
			new Request(`${BASE}/repos/alice/proj${path}`, { headers: { accept } }),
		);
	const cases = [
		["/commits/small", "application/vnd.github.diff"],
		["/commits/small", "application/vnd.github.patch"],
		["/compare/main...small", "application/vnd.github.diff"],
	] as const;
	for (const [path, accept] of cases) {
		const full = await media(path, accept);
		expect(full.status).toBe(200);
		const text = await full.text();
		expect(text.length).toBeGreaterThan(0);
		const size = new TextEncoder().encode(text).byteLength;
		const before = apiCaps.diffMediaBytes;
		try {
			apiCaps.diffMediaBytes = size - 1;
			expect((await media(path, accept)).status).toBe(406);
			apiCaps.diffMediaBytes = size;
			const exact = await media(path, accept);
			expect(exact.status).toBe(200);
			expect(await exact.text()).toBe(text);
		} finally {
			apiCaps.diffMediaBytes = before;
		}
	}
});
