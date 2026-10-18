/**
 * @vitest-environment node
 *
 * Native-git smoke test: the real `git` CLI against the real `/api/git/$`
 * route handler (src/routes/api/git.$.ts) on a loopback HTTP server, over
 * the real storage stack (git-fs.ts → src/lib/r2.ts, signing and all) backed
 * by an in-memory S3 endpoint, with an in-memory Postgres (pglite) for the
 * app's own tables. Nothing here touches the network, a real database, or —
 * importantly — the user's own git configuration: every git invocation gets
 * a scratch HOME and GIT_CONFIG_GLOBAL, with system config disabled.
 *
 * Not part of `pnpm test` (the app's unit tests never depend on a native git
 * binary). Run with `pnpm smoke:git`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);

vi.hoisted(() => {
	process.env.DATABASE_URL ??= "postgresql://test@localhost/test";
	process.env.BETTER_AUTH_SECRET ??=
		"test-better-auth-secret-with-32-plus-characters";
	process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
	process.env.R2_BUCKET_NAME = "smoke-bucket";
	process.env.R2_ENDPOINT = "https://smoke.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "smoke-key";
	process.env.R2_SECRET_ACCESS_KEY = "smoke-secret";
});

const fakeS3 = vi.hoisted(() => ({
	objects: new Map<string, Uint8Array>(),
	requests: [] as { method: string; key: string; query: string }[],
}));

vi.mock("#/lib/r2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/r2")>();
	const { createFakeS3 } = await import(
		"../../src/server/__tests__/helpers/fake-s3-fetch"
	);
	const s3 = createFakeS3({ bucket: "smoke-bucket" });
	fakeS3.objects = s3.objects;
	fakeS3.requests = s3.requests;
	return {
		...actual,
		createR2ObjectStoreFromEnv: (
			contentType?: (key: string) => string | undefined,
		) =>
			actual.createR2ObjectStore({
				endpoint: "https://smoke.r2.cloudflarestorage.com",
				bucket: "smoke-bucket",
				accessKeyId: "smoke-key",
				secretAccessKey: "smoke-secret",
				contentType,
				fetch: s3.fetch,
			}),
	};
});

vi.mock("#/db", async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const { pushSchema } = await import("drizzle-kit/api");
	const schema = await import("../../src/db/schema");
	const db = drizzle(new PGlite(), { schema });
	const { apply } = await pushSchema(
		schema as unknown as Record<string, unknown>,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();
	return { db };
});

vi.mock("#/lib/auth", () => ({
	auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("@tanstack/react-start", () => import("@/test/server-test-utils"));

const USER = {
	id: "smoke_user",
	username: "smoker",
	email: "smoke@example.com",
	name: "Smoke Tester",
};
vi.mock("#/server/session", () => ({
	getCurrentUser: vi.fn(async () => USER),
	getCurrentUserOptional: vi.fn(async () => USER),
}));

const PAT = "ghp_smoketestpersonalaccesstoken0000";
const REPO = "smoke-repo";

let server: Server;
let remote: string;
let work: string;
let gitEnv: NodeJS.ProcessEnv;

/** Run git with an isolated config: never the user's own. */
async function git(cwd: string, ...args: string[]) {
	const { stdout, stderr } = await run("git", args, {
		cwd,
		env: gitEnv,
		maxBuffer: 64 * 1024 * 1024,
	});
	return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function gitFails(cwd: string, ...args: string[]): Promise<string> {
	try {
		await git(cwd, ...args);
	} catch (err) {
		const e = err as { stderr?: string; stdout?: string };
		return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
	}
	throw new Error(`git ${args.join(" ")} unexpectedly succeeded`);
}

async function commitFile(dir: string, file: string, content: string) {
	await writeFile(path.join(dir, file), content);
	await git(dir, "add", file);
	await git(dir, "commit", "-q", "-m", `edit ${file}`);
}

async function serverPackCount(): Promise<number> {
	return [...fakeS3.objects.keys()].filter(
		(key) =>
			key.startsWith(`repos/${USER.username}/${REPO}/git/objects/pack/`) &&
			key.endsWith(".pack"),
	).length;
}

beforeAll(async () => {
	work = await mkdtemp(path.join(tmpdir(), "pushstack-smoke-"));
	const home = path.join(work, "home");
	await run("mkdir", ["-p", home]);
	const globalConfig = path.join(home, "gitconfig");
	await writeFile(
		globalConfig,
		[
			"[user]",
			"\tname = Smoke Tester",
			"\temail = smoke@example.com",
			"[init]",
			"\tdefaultBranch = main",
			"[protocol]",
			"\tversion = 0",
			"[advice]",
			"\tdetachedHead = false",
		].join("\n"),
	);
	gitEnv = {
		PATH: process.env.PATH,
		HOME: home,
		XDG_CONFIG_HOME: home,
		GIT_CONFIG_GLOBAL: globalConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/usr/bin/false",
	};

	const { db } = await import("#/db");
	const { user, tokens } = await import("../../src/db/schema");
	const { hashToken } = await import("#/server/tokens");
	await db.insert(user).values({
		...USER,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(tokens).values({
		userId: USER.id,
		name: "smoke",
		tokenHash: await hashToken(PAT),
		scopes: ["repo:write"],
	});

	const { createRepository } = await import("#/server/repositories");
	await createRepository({ data: { name: REPO, visibility: "private" } });

	// The production route handler itself.
	const { Route } = await import("../../src/routes/api/git.$");
	const handlers = (
		Route.options as unknown as {
			server: {
				handlers: Record<
					"GET" | "POST",
					(ctx: { request: Request }) => Promise<Response>
				>;
			};
		}
	).server.handlers;

	server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) {
			if (typeof v === "string") headers.set(k, v);
		}
		const request = new Request(`http://127.0.0.1${req.url}`, {
			method: req.method,
			headers,
			body:
				req.method === "GET" || req.method === "HEAD"
					? undefined
					: Buffer.concat(chunks),
		});
		const handler = handlers[req.method as "GET" | "POST"];
		const response = handler
			? await handler({ request })
			: new Response("Method not allowed", { status: 405 });
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");
	remote = `http://${USER.username}:${PAT}@127.0.0.1:${address.port}/api/git/${USER.username}/${REPO}.git`;
}, 60_000);

afterAll(async () => {
	await new Promise<void>((resolve) => server?.close(() => resolve()));
	if (work) await rm(work, { recursive: true, force: true });
});

describe("native git against the pushstack git endpoint", () => {
	it("clones an empty repository, then pushes its first commit", async () => {
		await git(work, "clone", "-q", remote, "a");
		const a = path.join(work, "a");
		await commitFile(a, "README.md", "# smoke\n");
		await git(a, "push", "-q", "origin", "main");
		const { stdout } = await git(work, "ls-remote", remote);
		expect(stdout).toMatch(/refs\/heads\/main/);
	}, 60_000);

	it("serves a full clone that passes fsck", async () => {
		await git(work, "clone", "-q", remote, "b");
		const b = path.join(work, "b");
		expect(await readFile(path.join(b, "README.md"), "utf8")).toBe("# smoke\n");
		await git(b, "fsck", "--full", "--strict");
	}, 60_000);

	it("accepts many incremental pushes, crossing the repack threshold", async () => {
		const a = path.join(work, "a");
		for (let i = 0; i < 6; i++) {
			await commitFile(a, `f${i}.txt`, `${i}\n`);
			await git(a, "push", "-q", "origin", "main");
		}
		expect(await serverPackCount()).toBeLessThan(4);
	}, 120_000);

	it("fetches incrementally into an older clone, consistently", async () => {
		const b = path.join(work, "b");
		await git(b, "pull", "-q", "--ff-only", "origin", "main");
		expect(await readFile(path.join(b, "f5.txt"), "utf8")).toBe("5\n");
		await git(b, "fsck", "--full", "--strict");
		const local = await git(b, "rev-parse", "HEAD");
		const { stdout } = await git(work, "ls-remote", remote, "refs/heads/main");
		expect(stdout.split("\t")[0]).toBe(local.stdout);
	}, 60_000);

	it("serves web-UI commits (packed writes) to fresh clones and fetches", async () => {
		const { createCommit } = await import("#/server/git-commit-write");
		await createCommit(USER.username, REPO, {
			branch: "main",
			message: "Edit from the web UI",
			files: [{ path: "web/edit.txt", content: "from the web\n" }],
			author: { name: USER.name, email: USER.email },
		});
		await git(work, "clone", "-q", remote, "c");
		const c = path.join(work, "c");
		expect(await readFile(path.join(c, "web/edit.txt"), "utf8")).toBe(
			"from the web\n",
		);
		await git(c, "fsck", "--full", "--strict");

		const b = path.join(work, "b");
		await git(b, "pull", "-q", "--ff-only", "origin", "main");
		expect(await readFile(path.join(b, "web/edit.txt"), "utf8")).toBe(
			"from the web\n",
		);
	}, 60_000);

	it("rejects a non-fast-forward push, but accepts it forced", async () => {
		const c = path.join(work, "c");
		const a = path.join(work, "a");
		// `a` is behind the web commit; its next push isn't a fast-forward.
		await commitFile(a, "diverged.txt", "x\n");
		const out = await gitFails(a, "push", "origin", "main");
		expect(out).toMatch(/rejected|fetch first|non-fast-forward/);
		await git(a, "push", "-q", "--force", "origin", "main");
		await git(c, "fetch", "-q", "origin");
		const { stdout } = await git(c, "rev-parse", "origin/main");
		expect(stdout).toBe((await git(a, "rev-parse", "HEAD")).stdout);
	}, 60_000);

	it("creates and deletes branches and tags over the wire", async () => {
		const a = path.join(work, "a");
		await git(a, "checkout", "-q", "-b", "feature");
		await commitFile(a, "feature.txt", "feature\n");
		await git(a, "push", "-q", "origin", "feature");
		await git(a, "tag", "-a", "v1.0", "-m", "release");
		await git(a, "push", "-q", "origin", "v1.0");
		let refs = (await git(work, "ls-remote", remote)).stdout;
		expect(refs).toMatch(/refs\/heads\/feature/);
		expect(refs).toMatch(/refs\/tags\/v1\.0/);

		await git(work, "clone", "-q", "--branch", "v1.0", remote, "tagged");
		expect(
			await readFile(path.join(work, "tagged", "feature.txt"), "utf8"),
		).toBe("feature\n");

		await git(a, "push", "-q", "origin", "--delete", "feature");
		refs = (await git(work, "ls-remote", remote)).stdout;
		expect(refs).not.toMatch(/refs\/heads\/feature/);
	}, 60_000);

	it("refuses to delete the default branch", async () => {
		const a = path.join(work, "a");
		const out = await gitFails(a, "push", "origin", "--delete", "main");
		expect(out).toMatch(/deletion of the current branch prohibited/);
	}, 60_000);

	it("merges a diverged branch (object-level) and serves the merge commit", async () => {
		const a = path.join(work, "a");
		await git(a, "checkout", "-q", "main");
		await git(a, "pull", "-q", "--ff-only", "origin", "main");
		await git(a, "checkout", "-q", "-b", "topic");
		await commitFile(a, "topic.txt", "topic\n");
		await git(a, "push", "-q", "origin", "topic");
		await git(a, "checkout", "-q", "main");
		await commitFile(a, "main-only.txt", "main\n");
		await git(a, "push", "-q", "origin", "main");

		const { mergeBranches } = await import("#/server/git-merge-iso");
		const merged = await mergeBranches(USER.username, REPO, "topic", "main", {
			message: "Merge topic",
			authorName: USER.name,
			authorEmail: USER.email,
		});
		expect(merged.success).toBe(true);

		await git(a, "pull", "-q", "--ff-only", "origin", "main");
		const parents = (await git(a, "rev-list", "--parents", "-n", "1", "HEAD"))
			.stdout.split(" ");
		expect(parents).toHaveLength(3);
		expect(await readFile(path.join(a, "topic.txt"), "utf8")).toBe("topic\n");
		await git(a, "fsck", "--full", "--strict");
	}, 60_000);

	it("rejects a bad token", async () => {
		const bad = remote.replace(PAT, "ghp_wrongwrongwrongwrongwrong0000");
		const out = await gitFails(work, "ls-remote", bad);
		expect(out).toMatch(/401|Authentication failed|could not read/i);
	}, 30_000);

	it("never wrote a loose object to storage", () => {
		const loose = [...fakeS3.objects.keys()].filter((key) =>
			/\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(key),
		);
		expect(loose).toEqual([]);
	});
});
