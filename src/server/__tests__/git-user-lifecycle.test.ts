/**
 * Full lifecycle integration test:
 *   create user -> create repo -> clone it over the real git smart-HTTP
 *   protocol using the user's PAT -> delete repo -> delete user.
 *
 * This runs the real business logic end to end:
 *   - repositories.ts (createRepository / deleteRepository / findRepositoryByName)
 *   - git-auth.ts (PAT authentication + repo-access authorization)
 *   - repo-access.ts (real, DB-driven — not mocked)
 *   - git-http.ts (serveGitRequest, the production route's handler, behind a
 *     real loopback HTTP server)
 *   - git-fs.ts / src/lib/r2.ts / git-write.ts (the R2 storage stack —
 *     real request signing and XML listing, all writes straight to R2)
 *
 * Only two things are faked, because they're external infrastructure that
 * doesn't exist in a test environment:
 *   - Postgres -> replaced with an in-memory embedded Postgres (pglite), using
 *     the project's real drizzle schema (src/db/schema.ts), so every query in
 *     the modules above runs against a real relational database.
 *   - R2 -> an in-memory S3 endpoint (helpers/fake-s3-fetch.ts) handed to
 *     src/lib/r2.ts's real store as its `fetch`, so everything above it —
 *     SigV4 signing, ListObjectsV2 parsing, server-side copy — runs for real.
 *
 * The clone and push use isomorphic-git's own client talking to a real Node
 * http server over 127.0.0.1 — no native `git` binary anywhere. This still
 * exercises the real wire protocol (pkt-line framing, `info/refs`,
 * `upload-pack`, side-band-64k) end to end, since isomorphic-git implements
 * that protocol independently rather than shelling out; it's just a JS
 * client instead of a native one.
 */

import { createHash } from "node:crypto";
import fs, { promises as nodeFs } from "node:fs";
import nodeHttp, { createServer, type Server } from "node:http";
import git, { type HttpClient } from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// isomorphic-git's bundled `isomorphic-git/http/node` transport (built on the
// `simple-get` package) hung indefinitely against this test's plain
// node:http server — reproducibly stuck after the server had already sent a
// complete, correctly-framed response and closed the socket, which points at
// that transport's response/decompression handling rather than anything in
// our protocol implementation. A minimal client built directly on node:http
// (symmetric with the equally-plain node:http server below) sidesteps it
// while still exercising the real wire protocol over a real socket.
const nodeHttpClient: HttpClient = {
	async request({ url, method = "GET", headers = {}, body }) {
		const chunks: Buffer[] = [];
		if (body) {
			for await (const chunk of body) chunks.push(Buffer.from(chunk));
		}
		const requestBody = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

		return new Promise((resolve, reject) => {
			const req = nodeHttp.request(url, { method, headers }, (res) => {
				const responseChunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => responseChunks.push(chunk));
				res.on("end", () => {
					const responseHeaders: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						if (value !== undefined) {
							responseHeaders[key] = Array.isArray(value)
								? value.join(", ")
								: value;
						}
					}
					resolve({
						url,
						method,
						statusCode: res.statusCode ?? 0,
						statusMessage: res.statusMessage ?? "",
						headers: responseHeaders,
						body: (async function* () {
							yield new Uint8Array(Buffer.concat(responseChunks));
						})(),
					});
				});
				res.on("error", reject);
			});
			req.on("error", reject);
			if (requestBody) req.write(requestBody);
			req.end();
		});
	},
};

// Must be hoisted so r2.ts's isR2Configured() sees these before any source
// module is imported.
const ENV = vi.hoisted(() => {
	const os = require("node:os");
	const path = require("node:path");
	const base = path.join(os.tmpdir(), `pushstack-lifecycle-${Date.now()}`);
	process.env.R2_BUCKET_NAME = "test-bucket";
	process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "test-key";
	process.env.R2_SECRET_ACCESS_KEY = "test-secret";
	return { base, cloneDir: path.join(base, "clone") };
});

// --- fake R2: an in-memory S3 endpoint behind src/lib/r2.ts's real store ---
const fakeS3 = vi.hoisted(() => ({
	objects: new Map<string, Uint8Array>(),
}));

vi.mock("#/lib/r2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/r2")>();
	const { createFakeS3 } = await import("./helpers/fake-s3-fetch");
	const s3 = createFakeS3({ bucket: "test-bucket" });
	fakeS3.objects = s3.objects;
	return {
		...actual,
		createR2ObjectStoreFromEnv: (
			contentType?: (key: string) => string | undefined,
		) =>
			actual.createR2ObjectStore({
				endpoint: "https://test-account.r2.cloudflarestorage.com",
				bucket: "test-bucket",
				accessKeyId: "test-key",
				secretAccessKey: "test-secret",
				contentType,
				fetch: s3.fetch,
			}),
	};
});

// --- real Postgres (embedded, in-memory) replacing #/db, seeded with the
// project's actual drizzle schema so every query below is real. ---
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const TEST_USER = {
	id: "user_lifecycle_1",
	username: "octocat",
	email: "octocat@example.com",
	name: "Octo Cat",
};

vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));

// The web session only decides who calls createRepository/deleteRepository;
// git auth below is by PAT alone.
vi.mock("../session", () => ({
	getCurrentUser: vi.fn(async () => TEST_USER),
	getCurrentUserOptional: vi.fn(async () => TEST_USER),
}));

const REPO_NAME = "hello-world";
const RENAMED = "hello-renamed";
const README_CONTENT = "# Hello World\n\nCreated in the lifecycle test.\n";
const PAT = "pst_lifecycletestpersonalaccesstoken";

let server: Server;
let baseUrl: string;

function gitClone(
	url: string,
	dir: string,
	credentials?: { username: string; password: string },
): Promise<void> {
	return git.clone({
		fs,
		http: nodeHttpClient,
		dir,
		url,
		onAuth: credentials ? () => credentials : undefined,
	});
}

beforeAll(async () => {
	// Import after env + mocks are wired up (matches git-integration.test.ts's pattern).
	const { db } = await import("../../db");
	const { user } = await import("../../db/schema");
	const { tokens } = await import("../../db/app-schema");

	await db.insert(user).values({
		id: TEST_USER.id,
		name: TEST_USER.name,
		email: TEST_USER.email,
		emailVerified: true,
		username: TEST_USER.username,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// Seed the token row directly: only its hash is stored.
	await db.insert(tokens).values({
		userId: TEST_USER.id,
		name: "lifecycle-test-token",
		tokenHash: createHash("sha256").update(PAT).digest("hex"),
		scopes: ["repo:write"],
	});

	const { serveGitRequest } = await import("../git-http");
	server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) {
			if (typeof v === "string") headers.set(k, v);
		}
		const response = await serveGitRequest(
			new Request(`http://127.0.0.1${req.url}`, {
				method: req.method,
				headers,
				body: req.method === "GET" ? undefined : Buffer.concat(chunks),
			}),
		);
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("server did not bind a port");
	baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	);
	await nodeFs.rm(ENV.base, { recursive: true, force: true }).catch(() => {});
});

describe("user -> repo -> clone with PAT -> delete repo -> delete user", () => {
	it("creates the repository as a private repo owned by the user", async () => {
		const { createRepository } = await import("../repositories");

		const repo = await createRepository({
			data: {
				name: REPO_NAME,
				description: "test repo",
				visibility: "private",
			},
		});

		expect(repo.name).toBe(REPO_NAME);
		expect(repo.ownerId).toBe(TEST_USER.id);
		expect(repo.visibility).toBe("private");

		// initBareRepo must leave HEAD/config in storage on its own — regression
		// guard for the bug where a post-init sync call deleted them as "stale".
		const keys = [...fakeS3.objects.keys()].filter((k) =>
			k.startsWith(`repos/${TEST_USER.username}/${REPO_NAME}/`),
		);
		expect(keys).toContain(`repos/${TEST_USER.username}/${REPO_NAME}/git/HEAD`);
		expect(keys).toContain(
			`repos/${TEST_USER.username}/${REPO_NAME}/git/config`,
		);
	});

	it("seeds an initial commit directly (as the first push would)", async () => {
		const { createCommit } = await import("../git-write");

		const sha = await createCommit(TEST_USER.username, REPO_NAME, {
			branch: "main",
			message: "Initial commit",
			files: [{ path: "README.md", content: README_CONTENT }],
			author: { name: TEST_USER.name, email: TEST_USER.email },
		});

		expect(sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it("rejects an anonymous clone of the private repo (no credentials)", async () => {
		await expect(
			gitClone(
				`${baseUrl}/api/git/${TEST_USER.username}/${REPO_NAME}.git`,
				`${ENV.cloneDir}-anon`,
			),
		).rejects.toThrow();
	});

	it("rejects a bad token", async () => {
		const url = `${baseUrl}/api/git/${TEST_USER.username}/${REPO_NAME}.git`;
		await expect(
			gitClone(url, `${ENV.cloneDir}-badtoken`, {
				username: TEST_USER.username,
				password: "pst_wrongtoken000000",
			}),
		).rejects.toThrow();
	});

	it("clones the private repo over HTTP using the user's PAT", async () => {
		const url = `${baseUrl}/api/git/${TEST_USER.username}/${REPO_NAME}.git`;
		await gitClone(url, ENV.cloneDir, {
			username: TEST_USER.username,
			password: PAT,
		});

		const readme = await nodeFs.readFile(`${ENV.cloneDir}/README.md`, "utf8");
		expect(readme).toBe(README_CONTENT);
	});

	it("pushes a new commit over HTTP with the PAT, straight into R2", async () => {
		await nodeFs.writeFile(`${ENV.cloneDir}/NOTES.md`, "pushed\n");
		await git.add({ fs, dir: ENV.cloneDir, filepath: "NOTES.md" });
		const pushedSha = await git.commit({
			fs,
			dir: ENV.cloneDir,
			message: "Add notes",
			author: { name: TEST_USER.name, email: TEST_USER.email },
		});

		// isomorphic-git's push always asks for (and demuxes) side-band-64k.
		const result = await git.push({
			fs,
			http: nodeHttpClient,
			dir: ENV.cloneDir,
			remote: "origin",
			ref: "main",
			onAuth: () => ({ username: TEST_USER.username, password: PAT }),
		});
		expect(result.ok).toBe(true);
		expect(result.refs["refs/heads/main"]?.ok).toBe(true);

		// The ref and the pack (with its index) landed in R2 itself.
		const prefix = `repos/${TEST_USER.username}/${REPO_NAME}/git/`;
		expect(
			new TextDecoder().decode(fakeS3.objects.get(`${prefix}refs/heads/main`)),
		).toBe(`${pushedSha}\n`);
		const packFiles = [...fakeS3.objects.keys()].filter((key) =>
			key.startsWith(`${prefix}objects/pack/`),
		);
		expect(packFiles.some((key) => key.endsWith(".pack"))).toBe(true);
		expect(packFiles.some((key) => key.endsWith(".idx"))).toBe(true);

		// ...and the app's own read path serves the pushed content.
		const { getFileContent } = await import("../git-read");
		const content = await getFileContent(
			TEST_USER.username,
			REPO_NAME,
			"NOTES.md",
			"main",
		);
		expect(new TextDecoder().decode(content)).toBe("pushed\n");
	});

	it("renames the repository, moving its storage with it", async () => {
		const { findRepositoryByName, updateRepository } = await import(
			"../repositories"
		);
		const repo = await findRepositoryByName(TEST_USER.username, REPO_NAME);
		if (!repo) throw new Error("repo should exist before rename");

		await updateRepository({ data: { id: repo.id, name: RENAMED } });
		const oldPrefix = `repos/${TEST_USER.username}/${REPO_NAME}/`;
		const newPrefix = `repos/${TEST_USER.username}/${RENAMED}/`;
		const keys = [...fakeS3.objects.keys()];
		expect(keys.filter((key) => key.startsWith(oldPrefix))).toHaveLength(0);
		expect(keys).toContain(`${newPrefix}git/HEAD`);

		const { getFileContent } = await import("../git-read");
		const content = await getFileContent(
			TEST_USER.username,
			RENAMED,
			"NOTES.md",
			"main",
		);
		expect(new TextDecoder().decode(content)).toBe("pushed\n");

		// Back to the original name for the remaining steps.
		await updateRepository({ data: { id: repo.id, name: REPO_NAME } });
		expect(
			[...fakeS3.objects.keys()].some((key) => key.startsWith(oldPrefix)),
		).toBe(true);
	});

	it("deletes the repository", async () => {
		const { deleteRepository, findRepositoryByName } = await import(
			"../repositories"
		);

		const repoBefore = await findRepositoryByName(
			TEST_USER.username,
			REPO_NAME,
		);
		if (!repoBefore) throw new Error("repo should exist before delete");

		await deleteRepository({ data: { id: repoBefore.id } });

		const repoAfter = await findRepositoryByName(TEST_USER.username, REPO_NAME);
		expect(repoAfter).toBeNull();

		// Repo's git data must actually be gone from storage (fake R2), not just the DB row.
		const remaining = [...fakeS3.objects.keys()].filter((k) =>
			k.startsWith(`repos/${TEST_USER.username}/${REPO_NAME}/`),
		);
		expect(remaining).toHaveLength(0);
	});

	it("a subsequent clone attempt 404s once the repo is gone", async () => {
		const url = `${baseUrl}/api/git/${TEST_USER.username}/${REPO_NAME}.git`;
		await expect(
			gitClone(url, `${ENV.cloneDir}-postdelete`, {
				username: TEST_USER.username,
				password: PAT,
			}),
		).rejects.toThrow();
	});

	it("deletes the user (and cascades their token)", async () => {
		const { db } = await import("../../db");
		const { user } = await import("../../db/schema");
		const { tokens } = await import("../../db/app-schema");
		const { eq } = await import("drizzle-orm");

		await db.delete(user).where(eq(user.id, TEST_USER.id));

		const remainingUser = await db.query.user.findFirst({
			where: eq(user.id, TEST_USER.id),
		});
		expect(remainingUser).toBeUndefined();

		const remainingTokens = await db.query.tokens.findFirst({
			where: eq(tokens.userId, TEST_USER.id),
		});
		expect(remainingTokens).toBeUndefined();
	});
});
