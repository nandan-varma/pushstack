/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, run } from "pstk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
const { createUsers, signIn } = await import("../../test/app-harness");
const { handleApiRequest } = await import("../api");
const { mintToken } = await import("../../test/api-client");
const users = await createUsers("alice");
const configDir = await mkdtemp(join(tmpdir(), "pst-issues-contract-"));
let stdout = "";
let stderr = "";
const requests: Request[] = [];
const io: Io = {
	configDir,
	env: { PST_HOST: "localhost:3000" },
	isTTY: false,
	stdout: (text) => {
		stdout += text;
	},
	stderr: (text) => {
		stderr += text;
	},
	readStdin: async () => "stdin contract body",
	remotes: async () => ["http://localhost:3000/api/git/alice/issues.git"],
	fetch: async (input, init) => {
		const request = new Request(input, init);
		requests.push(request.clone());
		return handleApiRequest(request);
	},
};
async function invoke(...args: string[]) {
	stdout = "";
	stderr = "";
	requests.length = 0;
	const code = await run(args, io);
	return { code, stdout, stderr };
}
beforeAll(async () => {
	io.env.PST_TOKEN = await mintToken(users.alice, ["repo:write"]);
	const created = await invoke(
		"repo",
		"create",
		"issues",
		"--public",
		"--add-readme",
	);
	expect(created.code, created.stderr).toBe(0);
});
afterAll(async () => {
	await rm(configDir, { recursive: true, force: true });
});

describe("CLI issue commands against real REST dispatcher", () => {
	it("creates and views a labeled assigned issue with stdin body", async () => {
		const created = await invoke(
			"issue",
			"create",
			"-t",
			"First issue",
			"-F",
			"-",
			"-l",
			"bug",
			"-l",
			"question",
			"-a",
			"@me",
		);
		expect(created.code, created.stderr).toBe(0);
		expect(created.stdout).toBe(
			"http://localhost:3000/alice/issues/issues/1\n",
		);
		const viewed = await invoke(
			"issue",
			"view",
			"1",
			"--json",
			"number,title,body,state,stateReason,url,author,labels,assignees",
		);
		expect(viewed.code, viewed.stderr).toBe(0);
		expect(JSON.parse(viewed.stdout)).toMatchObject({
			number: 1,
			title: "First issue",
			body: "stdin contract body",
			state: "OPEN",
			stateReason: null,
			author: { login: "alice" },
			assignees: [{ login: "alice" }],
			labels: [{ name: "bug" }, { name: "question" }],
		});
	});
	it("closes with either reason and reopens through PATCH", async () => {
		for (const reason of ["completed", "not_planned"]) {
			const closed = await invoke("issue", "close", "1", "-r", reason);
			expect(closed.code, closed.stderr).toBe(0);
			expect(requests.map((r) => r.method)).toEqual(["GET", "PATCH"]);
			const viewed = await invoke(
				"issue",
				"view",
				"1",
				"--json",
				"state,stateReason,closedAt",
			);
			expect(JSON.parse(viewed.stdout)).toMatchObject({
				state: "CLOSED",
				stateReason: reason.toUpperCase(),
				closedAt: expect.any(String),
			});
			expect(
				(await invoke("issue", "list", "--json", "number")).stdout.trim(),
			).toBe("[]");
			expect(
				JSON.parse(
					(await invoke("issue", "list", "-s", "closed", "--json", "number"))
						.stdout,
				),
			).toEqual([{ number: 1 }]);
			const reopened = await invoke("issue", "reopen", "1");
			expect(reopened.code, reopened.stderr).toBe(0);
			const open = await invoke(
				"issue",
				"view",
				"1",
				"--json",
				"state,closedAt",
			);
			expect(JSON.parse(open.stdout)).toEqual({
				state: "OPEN",
				closedAt: null,
			});
		}
	});
	it("uses real label and assignee filtering", async () => {
		expect((await invoke("issue", "create", "-t", "Unassigned")).code).toBe(0);
		const filtered = await invoke(
			"issue",
			"list",
			"-l",
			"bug,question",
			"-a",
			"@me",
			"--json",
			"number",
		);
		expect(filtered.code, filtered.stderr).toBe(0);
		expect(JSON.parse(filtered.stdout)).toEqual([{ number: 1 }]);
		const unassigned = await invoke(
			"issue",
			"list",
			"-a",
			"none",
			"--json",
			"number",
		);
		expect(JSON.parse(unassigned.stdout)).toEqual([{ number: 2 }]);
	});
	it("follows mixed issue/PR pages, excludes PRs before counting the limit and rejects PR mutation", async () => {
		signIn(users.alice);
		const { getRepositoryByName } = await import("../repositories");
		const repo = await getRepositoryByName({
			data: { owner: "alice", name: "issues" },
		});
		if (!repo) throw new Error("missing fixture repository");
		const files = await import("../files");
		await files.createBranch({ data: { repoId: repo.id, name: "topic" } });
		await files.uploadFile({
			data: {
				repoId: repo.id,
				branchName: "topic",
				path: "topic.txt",
				content: btoa("topic\n"),
				commitMessage: "Topic change",
			},
		});
		const { createPullRequest } = await import("../pull-requests");
		const pr = await createPullRequest({
			data: {
				repoId: repo.id,
				title: "A pull request",
				sourceBranchName: "topic",
				targetBranchName: "main",
			},
		});
		const list = await invoke("issue", "list", "-L", "1", "--json", "number");
		expect(list.code, list.stderr).toBe(0);
		expect(JSON.parse(list.stdout)).toEqual([{ number: 2 }]);
		expect(requests).toHaveLength(2);
		expect(requests[1]?.url).toContain("page=2");
		for (const sub of ["view", "close", "reopen"]) {
			const result = await invoke("issue", sub, String(pr.number));
			expect(result.code).toBe(1);
			expect(result.stderr).toContain("is a pull request");
			expect(requests.map((r) => r.method)).toEqual(["GET"]);
		}
	});
});
