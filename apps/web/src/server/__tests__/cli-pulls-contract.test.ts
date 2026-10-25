/** @vitest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, run } from "@pstk/cli";
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
const { call, mintToken, patch } = await import("../../test/api-client");
const users = await createUsers("alice");
const configDir = await mkdtemp(join(tmpdir(), "pst-pulls-contract-"));
let stdout = "";
let stderr = "";
const requests: Request[] = [];
const gitCalls: string[][] = [];
const io: Io = {
	configDir,
	env: { PST_HOST: "localhost:3000" },
	isTTY: false,
	git: async (args) => {
		gitCalls.push(args);
		return args[0] === "symbolic-ref" ? "topic\n" : "";
	},
	stdout: (text) => {
		stdout += text;
	},
	stderr: (text) => {
		stderr += text;
	},
	readStdin: async () => "stdin contract body",
	remotes: async () => ["http://localhost:3000/alice/pulls.git"],
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
	gitCalls.length = 0;
	const code = await run(args, io);
	return { code, stdout, stderr };
}
beforeAll(async () => {
	io.env.PST_TOKEN = await mintToken(users.alice, ["repo:write"]);
	const created = await invoke(
		"repo",
		"create",
		"pulls",
		"--public",
		"--add-readme",
	);
	expect(created.code, created.stderr).toBe(0);
});
afterAll(async () => {
	await rm(configDir, { recursive: true, force: true });
});

async function branch(name: string, file: string) {
	signIn(users.alice);
	const { getRepositoryByName } = await import("../repositories");
	const repo = await getRepositoryByName({
		data: { owner: "alice", name: "pulls" },
	});
	if (!repo) throw new Error("missing fixture repository");
	const files = await import("../files");
	await files.createBranch({ data: { repoId: repo.id, name } });
	await files.uploadFile({
		data: {
			repoId: repo.id,
			branchName: name,
			path: file,
			content: btoa(`${file}\n`),
			commitMessage: `Add ${file}`,
		},
	});
}

describe("CLI pr commands against real REST dispatcher", () => {
	it("creates from the current branch, views, lists and merges", async () => {
		await branch("topic", "topic.txt");
		const created = await invoke("pr", "create", "-t", "Topic", "-F", "-");
		expect(created.code, created.stderr).toBe(0);
		expect(created.stdout).toBe("http://localhost:3000/alice/pulls/pull/1\n");
		const viewed = await invoke(
			"pr",
			"view",
			"--json",
			"number,title,body,state,headRefName,baseRefName,author,url",
		);
		expect(viewed.code, viewed.stderr).toBe(0);
		expect(JSON.parse(viewed.stdout)).toMatchObject({
			number: 1,
			title: "Topic",
			body: "stdin contract body",
			state: "OPEN",
			headRefName: "topic",
			baseRefName: "main",
			author: { login: "alice" },
		});
		const listed = await invoke(
			"pr",
			"list",
			"-H",
			"topic",
			"--json",
			"number",
		);
		expect(JSON.parse(listed.stdout)).toEqual([{ number: 1 }]);
		const token = io.env.PST_TOKEN as string;
		const disabled = await call(
			"/repos/alice/pulls",
			patch(token, { allow_squash_merge: false }),
		);
		expect(disabled.status).toBe(200);
		const squash = await invoke("pr", "merge", "1", "--squash");
		expect(squash.code).toBe(1);
		expect(squash.stderr).toContain("Squash merges are not allowed");
		const merged = await invoke("pr", "merge", "1", "-t", "Ship topic");
		expect(merged.code, merged.stderr).toBe(0);
		expect(merged.stderr).toBe("✓ Merged pull request #1 (Topic)\n");
		expect(
			JSON.parse(
				(await invoke("pr", "view", "1", "--json", "state,mergedAt")).stdout,
			),
		).toMatchObject({ state: "MERGED", mergedAt: expect.any(String) });
		expect(
			JSON.parse(
				(await invoke("pr", "list", "-s", "merged", "--json", "number")).stdout,
			),
		).toEqual([{ number: 1 }]);
		expect((await invoke("pr", "reopen", "1")).code).toBe(1);
	});
	it("closes with a comment, reopens and checks out", async () => {
		await branch("second", "second.txt");
		expect(
			(await invoke("pr", "create", "-t", "Second", "-H", "second")).code,
		).toBe(0);
		const closed = await invoke("pr", "close", "second", "-c", "Not now");
		expect(closed.code, closed.stderr).toBe(0);
		expect(requests.map((r) => r.method)).toEqual(["GET", "POST", "PATCH"]);
		expect(
			JSON.parse(
				(await invoke("pr", "list", "-s", "closed", "--json", "number,state"))
					.stdout,
			),
		).toEqual([
			{ number: 2, state: "CLOSED" },
			{ number: 1, state: "MERGED" },
		]);
		const reopened = await invoke("pr", "reopen", "2");
		expect(reopened.code, reopened.stderr).toBe(0);
		const checkout = await invoke("pr", "checkout", "2");
		expect(checkout.code, checkout.stderr).toBe(0);
		expect(gitCalls[0]).toEqual([
			"fetch",
			"--",
			"http://localhost:3000/alice/pulls.git",
			"refs/heads/second",
		]);
	});
});
