import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import { writeHosts } from "./config";
import type { Io } from "./io";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
async function fixture() {
	const configDir = await mkdtemp(join(tmpdir(), "pst-test-"));
	directories.push(configDir);
	const fetchMock = vi.fn<typeof fetch>();
	const io: Io = {
		configDir,
		env: {},
		stdout: vi.fn(),
		stderr: vi.fn(),
		readStdin: async () => "pst_secret",
		remotes: async () => [],
		isTTY: false,
		fetch: fetchMock,
	};
	return { io, fetchMock };
}
const json = (value: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(value), init);

describe("CLI requests", () => {
	it("creates a bare repository name without an unnecessary user lookup", async () => {
		const { io, fetchMock } = await fixture();
		io.env.PST_TOKEN = "secret";
		fetchMock.mockResolvedValue(
			json({ html_url: "https://git.nandan.fyi/alice/project" }),
		);
		expect(
			await run(["repo", "create", "project", "--private", "--add-readme"], io),
		).toBe(0);
		expect(fetchMock).toHaveBeenCalledOnce();
		const call = fetchMock.mock.calls[0];
		if (!call) throw new Error("expected a request");
		const [url, request] = call;
		expect(String(url)).toBe("https://git.nandan.fyi/api/v3/user/repos");
		expect(JSON.parse(request?.body as string)).toEqual({
			name: "project",
			private: true,
			auto_init: true,
		});
	});

	it.each(["alice/", "/repo", "alice/repo/extra", "..", "a b"])(
		"rejects invalid create argument %s before a request",
		async (name) => {
			const { io, fetchMock } = await fixture();
			expect(await run(["repo", "create", name, "--public"], io)).toBe(1);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it("checks explicit ownership against the API", async () => {
		const { io, fetchMock } = await fixture();
		io.env.PST_TOKEN = "secret";
		fetchMock.mockResolvedValue(json({ login: "alice" }));
		expect(await run(["repo", "create", "other/repo", "--public"], io)).toBe(1);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("does not send credentials to an external pagination link", async () => {
		const { io, fetchMock } = await fixture();
		io.env.PST_TOKEN = "secret";
		fetchMock.mockResolvedValue(
			json([], {
				headers: { link: '<https://evil.example/api/v3/user>; rel="next"' },
			}),
		);
		expect(await run(["api", "user/repos", "--paginate"], io)).toBe(1);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
	});

	it("types API fields and resolves repository placeholders", async () => {
		const { io, fetchMock } = await fixture();
		io.env.PST_REPO = "alice/project";
		fetchMock.mockResolvedValue(json({ ok: true }));
		expect(
			await run(
				[
					"api",
					"repos/{owner}/{repo}",
					"-F",
					"private=true",
					"-f",
					"description=hello",
				],
				io,
			),
		).toBe(0);
		const call = fetchMock.mock.calls[0];
		if (!call) throw new Error("expected a request");
		const [url, request] = call;
		expect(String(url)).toContain("/repos/alice/project");
		expect(JSON.parse(request?.body as string)).toEqual({
			private: true,
			description: "hello",
		});
	});

	it("returns authentication exit code for HTTP 401", async () => {
		const { io, fetchMock } = await fixture();
		fetchMock.mockResolvedValue(
			json({ message: "Bad credentials" }, { status: 401 }),
		);
		expect(await run(["api", "user"], io)).toBe(4);
	});

	it("stores a verified token privately and lets the environment override it", async () => {
		const { io, fetchMock } = await fixture();
		fetchMock.mockResolvedValue(json({ login: "alice" }));
		expect(await run(["auth", "login", "--with-token"], io)).toBe(0);
		const path = join(io.configDir, "hosts.json");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await stat(io.configDir)).mode & 0o777).toBe(0o700);
		expect(
			JSON.parse(await readFile(path, "utf8"))["git.nandan.fyi"].user,
		).toBe("alice");
		io.env.PST_TOKEN = "environment";
		expect(await run(["auth", "token"], io)).toBe(0);
		expect(io.stdout).toHaveBeenLastCalledWith("environment\n");
		await writeHosts(io, {});
	});

	it("auth status sends an environment token only to its selected host", async () => {
		const { io, fetchMock } = await fixture();
		await writeHosts(io, {
			"git.nandan.fyi": { user: "alice", token: "saved-primary" },
			"secondary.example": { user: "bob", token: "saved-secondary" },
		});
		io.env.PST_TOKEN = "environment-secret";
		fetchMock.mockResolvedValue(json({ login: "alice" }));
		expect(await run(["auth", "status"], io)).toBe(0);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://git.nandan.fyi/api/v3/user",
		);
		expect(io.stdout).not.toHaveBeenCalledWith(
			expect.stringContaining("secondary.example"),
		);
	});

	it.each(["evil.example/path", "user@evil.example", "evil.example?x=1"])(
		"rejects invalid host %s",
		async (host) => {
			const { io, fetchMock } = await fixture();
			expect(await run(["api", "user", "--hostname", host], io)).toBe(1);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});
