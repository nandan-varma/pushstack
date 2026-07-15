/**
 * Full lifecycle integration test:
 *   create user -> create repo -> clone it over the real git smart-HTTP
 *   protocol using the user's PAT -> delete repo -> delete user.
 *
 * This runs the real business logic end to end:
 *   - repositories.ts (createRepository / deleteRepository / findRepositoryByName)
 *   - git-auth.ts (PAT authentication + repo-access authorization)
 *   - repo-access.ts (real, DB-driven — not mocked)
 *   - git-http-iso.ts (info/refs + upload-pack over a real loopback HTTP server)
 *   - git-r2-backend.ts / git-commit-write.ts (write path used when R2 is "configured")
 *
 * Only two things are faked, because they're external infrastructure that
 * doesn't exist in a test environment:
 *   - Postgres -> replaced with an in-memory embedded Postgres (pglite), using
 *     the project's real drizzle schema (src/db/schema.ts), so every query in
 *     the modules above runs against a real relational database.
 *   - R2 -> replaced with an in-memory Map behind #/lib/r2-operations, the one
 *     module boundary all R2 access already goes through.
 *
 * The clone itself uses isomorphic-git's own client talking to a real Node
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

// Must be hoisted so git-manager-iso.ts (module-level GIT_BASE_PATH) and
// r2.ts's isR2Configured() see these before any source module is imported.
const ENV = vi.hoisted(() => {
	const os = require("node:os");
	const path = require("node:path");
	const base = path.join(os.tmpdir(), `pushstack-lifecycle-${Date.now()}`);
	process.env.GIT_REPOS_PATH = path.join(base, "local-git");
	// isR2Configured() only checks presence of these — r2-operations is fully
	// mocked below, so no real R2/S3 client is ever constructed.
	process.env.R2_BUCKET_NAME = "test-bucket";
	process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "test-key";
	process.env.R2_SECRET_ACCESS_KEY = "test-secret";
	return { base, cloneDir: path.join(base, "clone") };
});

// --- fake R2: in-memory store backing #/lib/r2-operations ---
const fakeR2 = vi.hoisted(
	() => new Map<string, { content: Buffer; contentType?: string }>(),
);

vi.mock("#/lib/r2-operations", () => {
	function notFound(key: string) {
		return Object.assign(new Error(`NoSuchKey: ${key}`), { name: "NoSuchKey" });
	}
	return {
		uploadToR2: vi.fn(
			async (key: string, body: Buffer | string, contentType?: string) => {
				fakeR2.set(key, {
					content:
						typeof body === "string" ? Buffer.from(body) : Buffer.from(body),
					contentType,
				});
				return { key, bucketName: "test-bucket" };
			},
		),
		downloadFromR2: vi.fn(async (key: string) => {
			const entry = fakeR2.get(key);
			if (!entry) throw notFound(key);
			return {
				content: entry.content,
				contentType: entry.contentType,
				size: entry.content.length,
				etag: "test-etag",
			};
		}),
		getFileFromR2: vi.fn(async (key: string) => {
			const entry = fakeR2.get(key);
			if (!entry) throw notFound(key);
			return entry.content;
		}),
		deleteFromR2: vi.fn(async (key: string) => {
			fakeR2.delete(key);
			return { deleted: true, key };
		}),
		fileExistsInR2: vi.fn(async (key: string) => fakeR2.has(key)),
		headR2Object: vi.fn(async (key: string) => {
			const entry = fakeR2.get(key);
			if (!entry) return null;
			return {
				size: entry.content.length,
				contentType: entry.contentType,
				etag: "test-etag",
			};
		}),
		listR2Files: vi.fn(async (prefix?: string, maxKeys = 100) => {
			const out = [];
			for (const [key, entry] of fakeR2) {
				if (prefix && !key.startsWith(prefix)) continue;
				out.push({
					key,
					size: entry.content.length,
					lastModified: new Date(),
					etag: "test-etag",
				});
				if (out.length >= maxKeys) break;
			}
			return out;
		}),
		listAllR2Files: vi.fn(async (prefix?: string) => {
			const out = [];
			for (const [key, entry] of fakeR2) {
				if (prefix && !key.startsWith(prefix)) continue;
				out.push({
					key,
					size: entry.content.length,
					lastModified: new Date(),
					etag: "test-etag",
				});
			}
			return out;
		}),
		bulkUploadToR2: vi.fn(
			async (
				uploads: Array<{
					key: string;
					data: Buffer | string;
					contentType?: string;
				}>,
			) => {
				for (const { key, data, contentType } of uploads) {
					fakeR2.set(key, {
						content:
							typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
						contentType,
					});
				}
				return uploads.map(({ key }) => ({ key, success: true }));
			},
		),
		bulkDeleteFromR2: vi.fn(async (keys: string[]) => {
			let deleted = 0;
			for (const key of keys) {
				if (fakeR2.delete(key)) deleted++;
			}
			return { deleted, errors: 0 };
		}),
	};
});

// --- real Postgres (embedded, in-memory) replacing #/db, seeded with the
// project's actual drizzle schema so every query below is real. ---
vi.mock("../../db", async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const { pushSchema } = await import("drizzle-kit/api");
	const schema = await import("../../db/schema");

	const client = new PGlite();
	const db = drizzle(client, { schema });
	const { apply } = await pushSchema(
		schema as unknown as Record<string, unknown>,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();

	return { db };
});

// git-auth.ts checks for a cookie header before calling into Better Auth's
// session lookup; our clone request never sends one, so this is never
// exercised — stub it the same way git-auth-helpers.test.ts does, to avoid
// constructing a real Better Auth instance (which needs Resend config).
vi.mock("../../lib/auth", () => ({
	auth: { api: { getSession: vi.fn(async () => null) } },
}));

const TEST_USER = {
	id: "user_lifecycle_1",
	username: "octocat",
	email: "octocat@example.com",
	name: "Octo Cat",
};

// createRepository/deleteRepository are createServerFn-wrapped; unwrap them to
// plain callables, same shim as repositories.integration.test.ts.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		// biome-ignore lint/suspicious/noExplicitAny: test shim
		const obj: any = {};
		// biome-ignore lint/suspicious/noExplicitAny: test shim
		obj.validator = (validateFn: any) => {
			// biome-ignore lint/suspicious/noExplicitAny: test shim
			const inner: any = {};
			inner.handler =
				// biome-ignore lint/suspicious/noExplicitAny: test shim
				(handlerFn: any) => (args: any) =>
					handlerFn({ data: validateFn(args?.data ?? args) });
			return inner;
		};
		// biome-ignore lint/suspicious/noExplicitAny: test shim
		obj.handler = (handlerFn: any) => (args: any) => handlerFn(args);
		return obj;
	},
}));

// createRepository/deleteRepository call getCurrentUser() for "who is the
// caller" — this is Better Auth's cookie-session plumbing, orthogonal to the
// PAT-based git auth this test exercises. Stub it, matching the existing
// repositories.integration.test.ts convention.
vi.mock("../session", () => ({
	getCurrentUser: vi.fn(async () => TEST_USER),
	getCurrentUserOptional: vi.fn(async () => TEST_USER),
}));

const REPO_NAME = "hello-world";
const README_CONTENT = "# Hello World\n\nCreated in the lifecycle test.\n";
const PAT = "ghp_lifecycletestpersonalaccesstoken";

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
	const { user, tokens } = await import("../../db/schema");

	await db.insert(user).values({
		id: TEST_USER.id,
		name: TEST_USER.name,
		email: TEST_USER.email,
		emailVerified: true,
		username: TEST_USER.username,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// No PAT-issuing server function exists yet, so seed the token row the
	// same way the real one eventually would: store only the hash, exactly as
	// authenticateToken() in git-auth.ts looks it up.
	await db.insert(tokens).values({
		userId: TEST_USER.id,
		name: "lifecycle-test-token",
		tokenHash: createHash("sha256").update(PAT).digest("hex"),
		scopes: ["repo"],
	});

	// Minimal HTTP server mirroring src/routes/api/git.$.ts's dispatch, using
	// the same real handler functions the production route uses.
	const { parseGitUrl } = await import("../../lib/git-url-parser");
	const { authenticateGitRequest } = await import("../git-auth");
	const { handleInfoRefsIso, handleUploadPackIso } = await import(
		"../git-http-iso"
	);
	const { getRepoStorageCoordinates } = await import("../git-storage-naming");
	const { findRepositoryByName } = await import("../repositories");

	server = createServer(async (req, res) => {
		try {
			const url = `http://127.0.0.1${req.url}`;
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const bodyBuffer = Buffer.concat(chunks);

			const headers = new Headers();
			for (const [k, v] of Object.entries(req.headers)) {
				if (typeof v === "string") headers.set(k, v);
			}

			const request = new Request(url, {
				method: req.method,
				headers,
				body:
					req.method === "GET" || req.method === "HEAD"
						? undefined
						: bodyBuffer,
			});

			const parsed = parseGitUrl(url);
			if (!parsed?.service) {
				res.writeHead(400).end("Invalid git request");
				return;
			}

			const repository = await findRepositoryByName(parsed.owner, parsed.repo);
			if (!repository) {
				res.writeHead(404).end("Repository not found");
				return;
			}

			const authContext = await authenticateGitRequest(
				request,
				parsed.owner,
				parsed.repo,
				parsed.service === "git-receive-pack",
				repository,
			).catch((err) => {
				res
					.writeHead(401, {
						"WWW-Authenticate": 'Basic realm="Git Repository"',
					})
					.end(err instanceof Error ? err.message : "Unauthorized");
				return null;
			});
			if (!authContext) return;

			const storage = getRepoStorageCoordinates(repository);

			const result = parsed.isInfoRefs
				? await handleInfoRefsIso(
						storage.ownerKey,
						parsed.repo,
						parsed.service,
						authContext,
						repository.defaultBranch || "main",
					)
				: await handleUploadPackIso(
						storage.ownerKey,
						parsed.repo,
						request,
						authContext,
					);

			res.writeHead(result.status, result.headers);
			res.end(
				Buffer.isBuffer(result.body)
					? result.body
					: Buffer.from(result.body as string),
			);
		} catch (err) {
			res
				.writeHead(500)
				.end(err instanceof Error ? err.message : "Internal error");
		}
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
		const keys = [...fakeR2.keys()].filter((k) =>
			k.startsWith(`repos/${TEST_USER.username}/${REPO_NAME}/`),
		);
		expect(keys).toContain(`repos/${TEST_USER.username}/${REPO_NAME}/git/HEAD`);
		expect(keys).toContain(
			`repos/${TEST_USER.username}/${REPO_NAME}/git/config`,
		);
	});

	it("seeds an initial commit directly (as the first push would)", async () => {
		const { createCommit } = await import("../git-commit-write");

		const sha = await createCommit(
			TEST_USER.username,
			REPO_NAME,
			"Initial commit",
			[{ path: "README.md", content: README_CONTENT }],
			TEST_USER.name,
			TEST_USER.email,
		);

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
				password: "ghp_wrongtoken000000",
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

	it("deletes the repository", async () => {
		const { deleteRepository, findRepositoryByName } = await import(
			"../repositories"
		);

		const repoBefore = await findRepositoryByName(
			TEST_USER.username,
			REPO_NAME,
		);
		if (!repoBefore) throw new Error("repo should exist before delete");

		const result = await deleteRepository({ data: { id: repoBefore.id } });
		expect(result.success).toBe(true);

		const repoAfter = await findRepositoryByName(TEST_USER.username, REPO_NAME);
		expect(repoAfter).toBeUndefined();

		// Repo's git data must actually be gone from storage (fake R2), not just the DB row.
		const remaining = [...fakeR2.keys()].filter((k) =>
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
		const { user, tokens } = await import("../../db/schema");
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
