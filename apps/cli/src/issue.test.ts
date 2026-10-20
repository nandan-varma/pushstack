import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import type { Io } from "./io";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
async function fixture() {
	const configDir = await mkdtemp(join(tmpdir(), "pst-issue-"));
	dirs.push(configDir);
	const fetch = vi.fn<typeof globalThis.fetch>();
	const io: Io = {
		configDir,
		env: { PST_TOKEN: "pst_secret", PST_REPO: "alice/project" },
		stdout: vi.fn(),
		stderr: vi.fn(),
		readStdin: async () => "stdin body",
		remotes: async () => [],
		isTTY: false,
		fetch,
	};
	return { io, fetch };
}
const issue = {
	number: 12,
	title: "Example",
	body: "body text",
	state: "open",
	state_reason: null,
	html_url: "https://git.nandan.fyi/alice/project/issues/12",
	user: { login: "alice" },
	assignees: [{ login: "bob" }],
	labels: [{ name: "bug", color: "ffffff", description: null }],
	created_at: "2026-01-01",
	updated_at: "2026-01-02",
	closed_at: null,
};
const json = (data: unknown, headers?: ResponseInit["headers"], status = 200) =>
	new Response(JSON.stringify(data), { status, headers });

describe("issue commands", () => {
	it("treats help-looking body values as content", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(json(issue));
		expect(
			await run(["issue", "create", "--title=--help", "--body=-h"], io),
		).toBe(0);
		expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
			title: "--help",
			body: "-h",
		});
	});

	it.each(["list", "ls", "view", "create", "close", "reopen"])(
		"has request-free %s help",
		async (sub) => {
			const { io, fetch } = await fixture();
			expect(await run(["issue", sub, "--help"], io)).toBe(0);
			expect(fetch).not.toHaveBeenCalled();
			expect(io.stdout).toHaveBeenCalledWith(
				expect.stringContaining("pst issue"),
			);
		},
	);
	it.each([
		["create"],
		["create", "-t", " "],
		["create", "-t", "x", "-b", "", "-F", "-"],
		["create", "-t", "x", "-l", ""],
		["create", "-t", "x", "-a", "a,,b"],
		["list", "-L", "0"],
		["list", "-L", "Infinity"],
		["list", "-L", "10001"],
		["list", "-s", "merged"],
		["list", "--json", "__proto__"],
		["list", "--json", ""],
		["list", "-a", ""],
		["view", "0"],
		["view", "1.5"],
		["view", "9007199254740992"],
		["view", "12", "extra"],
		["view", "12", "--json", "unsupported"],
		["close", "12", "-r", "reopened"],
		["reopen", "12", "-r", "completed"],
	])("rejects invalid %j before any request", async (...args) => {
		const { io, fetch } = await fixture();
		expect(await run(["issue", ...args], io)).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("counts issues after excluding PRs and follows next links with credentials", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(
			json([{ ...issue, number: 13, pull_request: {} }, issue], {
				link: '<https://git.nandan.fyi/api/v3/repos/alice/project/issues?page=2>; rel="next"',
			}),
		);
		fetch.mockResolvedValueOnce(
			json([
				{ ...issue, number: 11 },
				{ ...issue, number: 10 },
			]),
		);
		expect(
			await run(
				[
					"issue",
					"ls",
					"-L",
					"2",
					"-s",
					"all",
					"-l",
					"bug",
					"-l",
					"help wanted",
					"-a",
					"bob",
					"--json",
					"number,title,state,author,assignees,labels",
				],
				io,
			),
		).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(2);
		const first = new URL(String(fetch.mock.calls[0]?.[0]));
		expect(Object.fromEntries(first.searchParams)).toEqual({
			per_page: "2",
			state: "all",
			labels: "bug,help wanted",
			assignee: "bob",
		});
		expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
			authorization: "token pst_secret",
		});
		expect(
			JSON.parse(vi.mocked(io.stdout).mock.calls[0]?.[0] ?? ""),
		).toMatchObject([
			{ number: 12, state: "OPEN", author: { login: "alice" } },
			{ number: 11 },
		]);
	});
	it("validates JSON fields even for empty lists", async () => {
		const { io, fetch } = await fixture();
		expect(await run(["issue", "list", "--json", "toString"], io)).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("stops cyclic pagination instead of hanging", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValue(
			json([{ ...issue, pull_request: {} }], {
				link: '<https://git.nandan.fyi/api/v3/repos/alice/project/issues?page=2>; rel="next"',
			}),
		);
		expect(await run(["issue", "list"], io)).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("rejects off-host pagination before forwarding credentials", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(
			json([], { link: '<https://evil.test/api/v3/issues>; rel="next"' }),
		);
		expect(await run(["issue", "list"], io)).toBe(1);
		expect(fetch).toHaveBeenCalledOnce();
	});
	it("infers the repository from remotes and prints readable issue details", async () => {
		const { io, fetch } = await fixture();
		delete io.env.PST_REPO;
		io.remotes = async () => [
			"https://git.nandan.fyi/api/git/alice/project.git",
		];
		fetch.mockResolvedValueOnce(json(issue));
		expect(await run(["issue", "view", "12"], io)).toBe(0);
		expect(io.stdout).toHaveBeenCalledWith(
			expect.stringContaining("Example #12\nOPEN • alice"),
		);
	});
	it.each(["view", "close", "reopen"])(
		"rejects PR numbers for %s without mutation",
		async (sub) => {
			const { io, fetch } = await fixture();
			fetch.mockResolvedValueOnce(json({ ...issue, pull_request: {} }));
			expect(await run(["issue", sub, "12"], io)).toBe(1);
			expect(fetch).toHaveBeenCalledOnce();
			expect(io.stderr).toHaveBeenCalledWith(
				expect.stringContaining("is a pull request"),
			);
		},
	);
	it.each([
		["close", [], { state: "closed", state_reason: "completed" }],
		[
			"close",
			["-r", "not_planned"],
			{ state: "closed", state_reason: "not_planned" },
		],
		["reopen", [], { state: "open", state_reason: "reopened" }],
	] as const)("updates issue state via %s %j", async (sub, args, expected) => {
		const { io, fetch } = await fixture();
		fetch.mockImplementation(async () => json(issue));
		expect(await run(["issue", sub, "12", ...args], io)).toBe(0);
		expect(fetch.mock.calls[1]?.[1]?.method).toBe("PATCH");
		expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual(
			expected,
		);
		expect(io.stdout).toHaveBeenCalledWith(`${issue.html_url}\n`);
	});
	it.each(["inline", "stdin", "file"])(
		"creates an issue with %s body and repeated metadata",
		async (source) => {
			const { io, fetch } = await fixture();
			const file = join(io.configDir, "body.md");
			await writeFile(file, "file body");
			fetch.mockImplementation(async () => json(issue));
			const bodyArgs =
				source === "inline"
					? ["-b", "inline body"]
					: ["-F", source === "stdin" ? "-" : file];
			expect(
				await run(
					[
						"issue",
						"create",
						"-t",
						"Example",
						...bodyArgs,
						"-l",
						"bug,help wanted",
						"-l",
						"triage",
						"-a",
						"alice",
						"-a",
						"bob",
					],
					io,
				),
			).toBe(0);
			expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
				title: "Example",
				body: `${source} body`,
				labels: ["bug", "help wanted", "triage"],
				assignees: ["alice", "bob"],
			});
		},
	);
	it("resolves @me with the active token and respects explicit host/repository", async () => {
		const { io, fetch } = await fixture();
		fetch
			.mockResolvedValueOnce(json({ login: "current" }))
			.mockResolvedValueOnce(json(issue));
		expect(
			await run(
				[
					"issue",
					"create",
					"--hostname",
					"localhost:3000",
					"-R",
					"bob/repo",
					"-t",
					"title",
					"-a",
					"@me",
				],
				io,
			),
		).toBe(0);
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			"http://localhost:3000/api/v3/user",
		);
		expect(String(fetch.mock.calls[1]?.[0])).toBe(
			"http://localhost:3000/api/v3/repos/bob/repo/issues",
		);
		expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
			title: "title",
			assignees: ["current"],
		});
	});
	it("requires auth for mutations and preserves exit code 4", async () => {
		const { io, fetch } = await fixture();
		delete io.env.PST_TOKEN;
		expect(await run(["issue", "create", "-t", "title"], io)).toBe(4);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("returns auth rejection and API errors without printing credentials", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(
			json({ message: "Bad credentials" }, undefined, 401),
		);
		expect(await run(["issue", "view", "12"], io)).toBe(4);
		expect(vi.mocked(io.stderr).mock.calls.flat().join("")).not.toContain(
			"pst_secret",
		);
		fetch.mockResolvedValueOnce(json({ message: "Not Found" }, undefined, 404));
		expect(await run(["issue", "view", "12"], io)).toBe(1);
	});
});
