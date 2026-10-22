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
const { createToken } = await import("../tokens");
const users = await createUsers("alice", "bob");
const configDir = await mkdtemp(join(tmpdir(), "pst-contract-"));
let token: string;
let stdout = "";
let stderr = "";
const requests: string[] = [];
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
	readStdin: async () => token,
	remotes: async () => ["http://localhost:3000/api/git/alice/public.git"],
	fetch: async (input, init) => {
		const request = new Request(input, init);
		requests.push(request.url);
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
	signIn(users.alice);
	token = (
		await createToken({
			data: {
				name: "cli-contract",
				scopes: ["repo:write"],
				lifetimeDays: null,
			},
		})
	).token;
});
afterAll(async () => {
	await rm(configDir, { recursive: true, force: true });
});

describe("CLI against the real REST dispatcher", () => {
	it("logs in using a real PAT and reports masked status", async () => {
		expect(await invoke("auth", "login", "--with-token")).toMatchObject({
			code: 0,
			stderr: expect.stringContaining("Logged in as alice"),
		});
		const status = await invoke("auth", "status");
		expect(status.code).toBe(0);
		expect(status.stdout).toContain("account alice");
		expect(status.stdout).not.toContain(token);
	});

	it("creates initialized public and private repositories", async () => {
		for (const [name, visibility] of [
			["public", "--public"],
			["secret", "--private"],
		] as const) {
			const result = await invoke(
				"repo",
				"create",
				`alice/${name}`,
				visibility,
				"--add-readme",
				"-d",
				"CLI contract",
			);
			expect(result.code, result.stderr).toBe(0);
			expect(result.stdout).toBe(`http://localhost:3000/alice/${name}\n`);
		}
		const branches = await invoke("api", "repos/alice/public/branches");
		expect(branches.code).toBe(0);
		expect(JSON.parse(branches.stdout)).toMatchObject([{ name: "main" }]);
	});

	it("infers repositories from git remotes and maps GitHub JSON fields", async () => {
		const result = await invoke(
			"repo",
			"view",
			"--json",
			"nameWithOwner,isPrivate,description,defaultBranchRef",
		);
		expect(result.code, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			nameWithOwner: "alice/public",
			isPrivate: false,
			description: "CLI contract",
			defaultBranchRef: { name: "main" },
		});
	});

	it("lists private repositories for the authenticated owner and filters visibility", async () => {
		const all = await invoke(
			"repo",
			"list",
			"alice",
			"--json",
			"nameWithOwner,isPrivate",
		);
		expect(all.code, all.stderr).toBe(0);
		expect(JSON.parse(all.stdout)).toEqual([
			{ nameWithOwner: "alice/public", isPrivate: false },
			{ nameWithOwner: "alice/secret", isPrivate: true },
		]);
		const privateOnly = await invoke(
			"repo",
			"list",
			"--visibility",
			"private",
			"--json",
			"name",
		);
		expect(privateOnly.code, privateOnly.stderr).toBe(0);
		expect(JSON.parse(privateOnly.stdout)).toEqual([{ name: "secret" }]);
	});

	it("limits own listings to owned repositories rather than collaborations", async () => {
		signIn(users.bob);
		const bobToken = (
			await createToken({
				data: {
					name: "collaboration",
					scopes: ["repo:write"],
					lifetimeDays: null,
				},
			})
		).token;
		const response = await handleApiRequest(
			new Request("http://localhost:3000/api/v3/user/repos", {
				method: "POST",
				headers: {
					authorization: `token ${bobToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: "collaborated", private: true }),
			}),
		);
		expect(response.status).toBe(201);
		const repo = (await response.json()) as { id: number };
		const publicResponse = await handleApiRequest(
			new Request("http://localhost:3000/api/v3/user/repos", {
				method: "POST",
				headers: {
					authorization: `token ${bobToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: "bob-public" }),
			}),
		);
		expect(publicResponse.status).toBe(201);
		const { addCollaboratorByUsername } = await import("../repositories");
		await addCollaboratorByUsername({
			data: { repoId: repo.id, username: "alice", role: "read" },
		});
		for (const args of [[], ["alice"]]) {
			const result = await invoke(
				"repo",
				"list",
				...args,
				"--json",
				"nameWithOwner",
			);
			expect(result.code, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual([
				{ nameWithOwner: "alice/public" },
				{ nameWithOwner: "alice/secret" },
			]);
		}
	});

	it("does not show public repositories when another owner's private visibility is requested", async () => {
		const privateOnly = await invoke(
			"repo",
			"list",
			"bob",
			"--visibility",
			"private",
			"--json",
			"name",
		);
		expect(privateOnly.code, privateOnly.stderr).toBe(0);
		expect(JSON.parse(privateOnly.stdout)).toEqual([]);
		// Alice can read Bob's shared private repository, but this API endpoint
		// intentionally exposes only public repositories, matching GitHub.
	});

	it("lists the environment token owner's private repositories without stored credentials", async () => {
		const environmentDir = await mkdtemp(join(tmpdir(), "pst-env-contract-"));
		const storedDir = io.configDir;
		try {
			io.configDir = environmentDir;
			io.env.PST_TOKEN = token;
			const result = await invoke(
				"repo",
				"list",
				"alice",
				"--json",
				"name,isPrivate",
			);
			expect(result.code, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual([
				{ name: "public", isPrivate: false },
				{ name: "secret", isPrivate: true },
			]);
		} finally {
			io.configDir = storedDir;
			delete io.env.PST_TOKEN;
			await rm(environmentDir, { recursive: true, force: true });
		}
	});

	it("follows real Link pagination and preserves authentication", async () => {
		const result = await invoke(
			"api",
			"user/repos?per_page=1&affiliation=owner",
			"--paginate",
		);
		expect(result.code, result.stderr).toBe(0);
		const pages = result.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { name: string }[]);
		expect(pages.flat().map((repo) => repo.name)).toEqual(["public", "secret"]);
		expect(requests).toHaveLength(2);
		expect(requests[1]).toContain("page=2");
	});

	it("surfaces API validation errors and bad credentials with exit codes", async () => {
		const duplicate = await invoke("repo", "create", "public", "--public");
		expect(duplicate.code).toBe(1);
		expect(duplicate.stderr).toContain("HTTP 422");
		io.env.PST_TOKEN = "pst_invalid";
		const invalid = await invoke("api", "user");
		expect(invalid.code).toBe(4);
		expect(invalid.stderr).toContain("HTTP 401");
		delete io.env.PST_TOKEN;
	});

	it("logs out and hides private repositories from anonymous requests", async () => {
		expect((await invoke("auth", "logout")).code).toBe(0);
		const hidden = await invoke("repo", "view", "alice/secret");
		expect(hidden.code).toBe(1);
		expect(hidden.stderr).toContain("HTTP 404");
	});
});
