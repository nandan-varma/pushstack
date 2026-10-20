import { mkdtemp, rm } from "node:fs/promises";
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
	const configDir = await mkdtemp(join(tmpdir(), "pst-pr-"));
	dirs.push(configDir);
	const fetch = vi.fn<typeof globalThis.fetch>();
	const git = vi.fn<(args: string[]) => Promise<string>>(async () => "");
	const io: Io = {
		configDir,
		env: { PST_TOKEN: "pst_secret", PST_REPO: "alice/project" },
		stdout: vi.fn(),
		stderr: vi.fn(),
		readStdin: async () => "stdin body",
		remotes: async () => [],
		isTTY: false,
		fetch,
		git,
	};
	return { io, fetch, git };
}
const pull = {
	number: 7,
	title: "Topic",
	body: "body",
	state: "open",
	html_url: "https://git.nandan.fyi/alice/project/pulls/7",
	user: { login: "alice" },
	head: {
		ref: "topic",
		sha: "a".repeat(40),
		repo: { clone_url: "https://git.nandan.fyi/api/git/alice/project.git" },
	},
	base: { ref: "main", sha: "b".repeat(40) },
	draft: false,
	created_at: "2026-01-01",
	updated_at: "2026-01-02",
	closed_at: null,
	merged_at: null,
};
const json = (data: unknown, headers?: ResponseInit["headers"], status = 200) =>
	new Response(JSON.stringify(data), { status, headers });
const url = (fetch: ReturnType<typeof vi.fn>, call = 0) =>
	new URL(String(fetch.mock.calls[call]?.[0]));
const sent = (fetch: ReturnType<typeof vi.fn>, call: number) =>
	JSON.parse(fetch.mock.calls[call]?.[1]?.body as string);

describe("pr commands", () => {
	it.each(["list", "ls", "view", "create", "merge", "close", "reopen", "co"])(
		"has request-free %s help",
		async (sub) => {
			const { io, fetch } = await fixture();
			expect(await run(["pr", sub, "--help"], io)).toBe(0);
			expect(fetch).not.toHaveBeenCalled();
			expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining("pst pr"));
		},
	);
	it.each([
		["create"],
		["create", "-t", "x", "-b", "y", "-F", "-"],
		["create", "-t", "x", "-H", " "],
		["list", "-L", "0"],
		["list", "-s", "draft"],
		["list", "--json", "nope"],
		["view", "1", "2"],
		["merge", "1", "--merge", "--squash"],
		["close", "1", "-c", " "],
		["checkout"],
		["frobnicate"],
	])("rejects %j before any request", async (...args) => {
		const { io, fetch } = await fixture();
		expect(await run(["pr", ...args], io)).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("lists merged pulls by filtering closed ones, with gh's columns", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(
			json([
				{ ...pull, state: "closed", merged_at: "2026-01-03" },
				{ ...pull, number: 8, state: "closed" },
			]),
		);
		expect(await run(["pr", "list", "-s", "merged", "-B", "main"], io)).toBe(0);
		const query = url(fetch).searchParams;
		expect(query.get("state")).toBe("closed");
		expect(query.get("base")).toBe("main");
		expect(io.stdout).toHaveBeenCalledTimes(1);
		expect(io.stdout).toHaveBeenCalledWith(
			"7\tTopic\ttopic\tMERGED\t2026-01-01\n",
		);
	});

	it("views by branch and prints gh-named JSON fields", async () => {
		const { io, fetch } = await fixture();
		fetch.mockResolvedValueOnce(json([pull]));
		expect(
			await run(
				[
					"pr",
					"view",
					"topic",
					"--json",
					"number,state,headRefName,baseRefName,author,isDraft",
				],
				io,
			),
		).toBe(0);
		expect(url(fetch).pathname).toBe("/api/v3/repos/alice/project/pulls");
		expect(url(fetch).searchParams.get("head")).toBe("topic");
		expect(
			JSON.parse((io.stdout as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]),
		).toEqual({
			number: 7,
			state: "OPEN",
			headRefName: "topic",
			baseRefName: "main",
			author: { login: "alice" },
			isDraft: false,
		});
	});

	it("views the current branch's pull without an argument", async () => {
		const { io, fetch, git } = await fixture();
		git.mockResolvedValueOnce("topic\n");
		fetch.mockResolvedValueOnce(json([]));
		expect(await run(["pr", "view"], io)).toBe(1);
		expect(git).toHaveBeenCalledWith([
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		]);
		expect(io.stderr).toHaveBeenCalledWith(
			expect.stringContaining('no open pull requests found for branch "topic"'),
		);
	});

	it("creates against the default branch from the current branch", async () => {
		const { io, fetch, git } = await fixture();
		git.mockResolvedValueOnce("topic\n");
		fetch
			.mockResolvedValueOnce(json({ default_branch: "trunk" }))
			.mockResolvedValueOnce(json(pull, undefined, 201));
		expect(await run(["pr", "create", "-t", "Topic", "-F", "-"], io)).toBe(0);
		expect(sent(fetch, 1)).toEqual({
			title: "Topic",
			body: "stdin body",
			head: "topic",
			base: "trunk",
		});
		expect(io.stdout).toHaveBeenCalledWith(`${pull.html_url}\n`);
	});

	it("merges with subject, body and head guard", async () => {
		const { io, fetch } = await fixture();
		fetch
			.mockResolvedValueOnce(json(pull))
			.mockResolvedValueOnce(json({ merged: true, sha: "c" }));
		expect(
			await run(
				[
					"pr",
					"merge",
					"7",
					"-t",
					"Subject",
					"-b",
					"Body",
					"--match-head-commit",
					pull.head.sha,
				],
				io,
			),
		).toBe(0);
		expect(fetch.mock.calls[1]?.[1]?.method).toBe("PUT");
		expect(url(fetch, 1).pathname).toBe(
			"/api/v3/repos/alice/project/pulls/7/merge",
		);
		expect(sent(fetch, 1)).toEqual({
			merge_method: "merge",
			commit_title: "Subject",
			commit_message: "Body",
			sha: pull.head.sha,
		});
		expect(io.stderr).toHaveBeenCalledWith(
			"✓ Merged pull request #7 (Topic)\n",
		);
	});

	it("refuses to merge or reopen merged pulls", async () => {
		for (const sub of ["merge", "reopen", "close"]) {
			const { io, fetch } = await fixture();
			fetch.mockResolvedValueOnce(
				json({ ...pull, state: "closed", merged_at: "2026-01-03" }),
			);
			expect(await run(["pr", sub, "7"], io)).toBe(1);
			expect(fetch).toHaveBeenCalledTimes(1);
		}
	});

	it("closes with a comment first", async () => {
		const { io, fetch } = await fixture();
		fetch
			.mockResolvedValueOnce(json(pull))
			.mockResolvedValueOnce(json({ id: 1 }, undefined, 201))
			.mockResolvedValueOnce(json({ ...pull, state: "closed" }));
		expect(await run(["pr", "close", "#7", "-c", "Bye"], io)).toBe(0);
		expect(url(fetch, 1).pathname).toBe(
			"/api/v3/repos/alice/project/issues/7/comments",
		);
		expect(sent(fetch, 1)).toEqual({ body: "Bye" });
		expect(sent(fetch, 2)).toEqual({ state: "closed" });
	});

	it("checks out a new local branch from FETCH_HEAD", async () => {
		const { io, fetch, git } = await fixture();
		fetch.mockResolvedValueOnce(json(pull));
		git.mockImplementation(async (args) => {
			if (args[0] === "rev-parse") throw new Error("missing");
			return "";
		});
		expect(await run(["pr", "checkout", "7"], io)).toBe(0);
		expect(git.mock.calls.map(([args]) => args)).toEqual([
			["fetch", "--", pull.head.repo.clone_url, "refs/heads/topic"],
			["rev-parse", "--verify", "--quiet", "refs/heads/topic"],
			["checkout", "-b", "topic", "FETCH_HEAD"],
		]);
	});

	it("fast-forwards an existing branch, or resets with --force", async () => {
		for (const [flag, last] of [
			[[], ["merge", "--ff-only", "FETCH_HEAD"]],
			[["-f"], ["reset", "--hard", "FETCH_HEAD"]],
		]) {
			const { io, fetch, git } = await fixture();
			fetch.mockResolvedValueOnce(json(pull));
			expect(
				await run(["pr", "checkout", "7", "-b", "local", ...(flag ?? [])], io),
			).toBe(0);
			expect(git.mock.calls.map(([args]) => args).slice(2)).toEqual([
				["checkout", "local", "--"],
				last,
			]);
		}
	});
	it.each([
		[{ head: { ...pull.head, ref: "a:b" } }, []],
		[{ head: { ...pull.head, ref: "-upload-pack=x" } }, []],
		[{ head: { ...pull.head, ref: "a..b" } }, []],
		[{}, ["-b", "x y"]],
		[{}, ["-b", "x.lock"]],
		[{}, ["--branch=-f"]],
		[{ head: { ...pull.head, repo: { clone_url: "ext::sh -c id" } } }, []],
		[{ head: { ...pull.head, repo: { clone_url: "file:///etc" } } }, []],
	])("never runs git for unsafe input %j %j", async (patch, flags) => {
		const { io, fetch, git } = await fixture();
		fetch.mockResolvedValueOnce(json({ ...pull, ...patch }));
		expect(await run(["pr", "checkout", "7", ...flags], io)).toBe(1);
		expect(git).not.toHaveBeenCalled();
	});
});
