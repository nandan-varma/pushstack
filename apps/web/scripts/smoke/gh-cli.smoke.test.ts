/**
 * @vitest-environment node
 *
 * Real-gh smoke test: the stock GitHub CLI against the app's real route
 * handlers (`/api/v3/$`, `/api/graphql`, git smart HTTP at the clone URL) over pglite and an
 * in-memory S3, exactly as a GitHub Enterprise Server host. gh runs with a
 * scratch GH_CONFIG_DIR and HOME: it never sees the user's own config.
 *
 * Transport: loopback HTTPS with a self-signed certificate generated here
 * (openssl), trusted only through SSL_CERT_FILE. gh allows no port in a
 * hostname, so it reaches `pushstack.test:443` through HTTPS_PROXY, a
 * loopback CONNECT proxy that tunnels to the HTTPS server. Skipped when gh
 * is not installed.
 *
 * GH_CAPTURE_FIXTURES=1 rewrites src/server/graphql/__fixtures__/gh/*.json
 * with the GraphQL documents gh sent: the fixtures graphql-fixtures.test.ts
 * replays.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);

/** The GHES hostname gh is pointed at; never resolved through DNS. */
const GH_HOST = "pushstack.test";

vi.hoisted(() => {
	process.env.DATABASE_URL ??= "postgresql://test@localhost/test";
	process.env.BETTER_AUTH_SECRET ??=
		"test-better-auth-secret-with-32-plus-characters";
	process.env.BETTER_AUTH_URL ??= "https://pushstack.test";
	process.env.R2_BUCKET_NAME = "smoke-bucket";
	process.env.R2_ENDPOINT = "https://smoke.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "smoke-key";
	process.env.R2_SECRET_ACCESS_KEY = "smoke-secret";
});

vi.mock("#/lib/r2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/r2")>();
	const { createFetchS3Store } = await import("git-fs-s3/fetch-s3");
	const { createFakeS3 } = await import("git-fs-s3/testing");
	const s3 = createFakeS3({ bucket: "smoke-bucket" });
	return {
		...actual,
		createR2ObjectStoreFromEnv: (
			contentType?: (key: string) => string | undefined,
		) =>
			createFetchS3Store({
				endpoint: "https://smoke.r2.cloudflarestorage.com",
				bucket: "smoke-bucket",
				accessKeyId: "smoke-key",
				secretAccessKey: "smoke-secret",
				contentType,
				fetch: s3.fetch,
			}),
	};
});

vi.mock("#/db", async () => ({
	db: await (await import("../../src/test/pglite-db")).createTestDb(),
}));
vi.mock("#/lib/auth", () => ({
	auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("@tanstack/react-start", () => import("@/test/server-test-utils"));

const USER = {
	id: "gh_smoke_user",
	username: "octo",
	email: "octo@example.com",
	name: "Octo Smoke",
};
vi.mock("#/server/session", () => ({
	getCurrentUser: vi.fn(async () => USER),
	getCurrentUserOptional: vi.fn(async () => USER),
}));

const PAT = "pst_ghsmoketestpersonalaccesstoken00";

function ghVersion(): string | null {
	try {
		return (
			execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0] ??
			null
		);
	} catch {
		return null;
	}
}
const GH_VERSION = ghVersion();

let server: Server;
let proxy: Server | undefined;
let work: string;
const host = GH_HOST;
let ghEnv: NodeJS.ProcessEnv;
/** Every GraphQL body gh sent, in order, tagged with the fixture it belongs to. */
const captured: {
	fixture: string;
	command: string;
	query: string;
	variables?: unknown;
}[] = [];
let current = { fixture: "", command: "" };

type Handler = (ctx: { request: Request }) => Promise<Response>;
function handlersOf(route: unknown): Record<string, Handler> {
	return (
		route as { options: { server: { handlers: Record<string, Handler> } } }
	).options.server.handlers;
}

/** Run gh; its GraphQL requests are captured as fixture `fixture`. */
async function ghAs(fixture: string, ...args: string[]) {
	current = { fixture, command: `gh ${args.join(" ")}` };
	try {
		const { stdout, stderr } = await run("gh", args, {
			env: ghEnv,
			maxBuffer: 16 * 1024 * 1024,
		});
		return { stdout: stdout.trim(), stderr: stderr.trim() };
	} finally {
		current = { fixture: "", command: "" };
	}
}

/** Run gh without capturing a fixture. */
const gh = (...args: string[]) => ghAs("", ...args);

async function ghFails(fixture: string, ...args: string[]) {
	try {
		await ghAs(fixture, ...args);
	} catch (err) {
		const e = err as { stderr?: string; stdout?: string };
		return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
	}
	throw new Error(`gh ${args.join(" ")} unexpectedly succeeded`);
}

// CI installs the pinned gh, so there a missing gh fails instead of skipping.
const enabled = GH_VERSION !== null || process.env.CI === "true";

async function listen(target: Server): Promise<number> {
	await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
	const address = target.address();
	if (!address || typeof address === "string") throw new Error("no port");
	return address.port;
}

beforeAll(async () => {
	if (!enabled) return;
	work = await mkdtemp(path.join(tmpdir(), "pushstack-gh-"));
	const home = path.join(work, "home");
	const config = path.join(work, "gh-config");
	await mkdir(home, { recursive: true });
	await mkdir(config, { recursive: true });

	const { db } = await import("#/db");
	const { user } = await import("../../src/db/schema");
	const { tokens } = await import("../../src/db/app-schema");
	const { hashToken } = await import("#/lib/token-scopes");
	await db.insert(user).values({
		...USER,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(tokens).values({
		userId: USER.id,
		name: "gh smoke",
		tokenHash: await hashToken(PAT),
		scopes: ["repo:write", "gist"],
	});

	const routes = {
		"/api/v3/": handlersOf((await import("../../src/routes/api/v3.$")).Route),
		"/api/graphql": handlersOf(
			(await import("../../src/routes/api/graphql")).Route,
		),
	};
	// Git smart HTTP at the clone URL, keyed by the path's last segment.
	const gitRoutes: Record<string, ReturnType<typeof handlersOf>> = {
		refs: handlersOf(
			(await import("../../src/routes/$owner.$name.info.refs")).Route,
		),
		"git-upload-pack": handlersOf(
			(await import("../../src/routes/$owner.$name.git-upload-pack")).Route,
		),
		"git-receive-pack": handlersOf(
			(await import("../../src/routes/$owner.$name.git-receive-pack")).Route,
		),
	};

	const { parseGistGitUrl, serveGistGitRequest } = await import(
		"../../src/server/git-http"
	);

	const serve = async (req: IncomingMessage, res: ServerResponse) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const body = Buffer.concat(chunks);
		const pathname = (req.url ?? "/").split("?")[0] ?? "/";
		if (pathname === "/api/graphql" && req.method === "POST") {
			const { query, variables } = JSON.parse(body.toString("utf8"));
			captured.push({ ...current, query, variables });
		}
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) {
			if (typeof v === "string") headers.set(k, v);
		}
		const request = new Request(`${process.env.BETTER_AUTH_URL}${req.url}`, {
			method: req.method,
			headers,
			body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
		});
		const prefix = (Object.keys(routes) as (keyof typeof routes)[]).find(
			(p) => pathname === p || pathname.startsWith(p),
		);
		const handler = prefix
			? routes[prefix][req.method ?? "GET"]
			: gitRoutes[pathname.split("/").pop() ?? ""]?.[req.method ?? "GET"];
		const response = parseGistGitUrl(request.url)
			? await serveGistGitRequest(request)
			: handler
				? await handler({ request })
				: new Response("Not Found", { status: 404 });
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	};

	ghEnv = {
		PATH: process.env.PATH,
		HOME: home,
		XDG_CONFIG_HOME: home,
		GH_CONFIG_DIR: config,
		GH_PROMPT_DISABLED: "1",
		GH_NO_UPDATE_NOTIFIER: "1",
		GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
		GH_SPINNER_DISABLED: "1",
		NO_COLOR: "1",
		...(process.env.GH_SMOKE_DEBUG && { GH_DEBUG: "api" }),
		GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
	};
	await writeFile(path.join(home, "gitconfig"), "");

	// gh accepts no port in a hostname, so it reaches pushstack.test:443
	// through HTTPS_PROXY: a loopback CONNECT proxy that tunnels every
	// connection to the HTTPS server, whose certificate names that host.
	const key = path.join(work, "key.pem");
	const cert = path.join(work, "cert.pem");
	await run("openssl", [
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-subj",
		`/CN=${GH_HOST}`,
		"-addext",
		`subjectAltName=DNS:${GH_HOST}`,
		"-keyout",
		key,
		"-out",
		cert,
	]);
	server = createHttpsServer(
		{ key: await readFile(key), cert: await readFile(cert) },
		serve,
	);
	const httpsPort = await listen(server);
	proxy = createHttpServer((_req, res) => {
		res.writeHead(405).end();
	});
	proxy.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
		if (req.url !== `${GH_HOST}:443`) {
			client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			return;
		}
		const upstream = connect(httpsPort, "127.0.0.1", () => {
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.on("error", () => client.destroy());
		client.on("error", () => upstream.destroy());
	});
	const proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
	Object.assign(ghEnv, {
		HTTPS_PROXY: proxyUrl,
		https_proxy: proxyUrl,
		SSL_CERT_FILE: cert,
		GIT_SSL_CAINFO: cert,
	});
	process.env.BETTER_AUTH_URL = `https://${host}`;

	const { createRepository } = await import("#/server/repositories");
	await createRepository({
		data: {
			name: "hello",
			visibility: "public",
			description: "Hello from PushStack",
		},
	});
	await createRepository({ data: { name: "hidden", visibility: "private" } });
}, 60_000);

afterAll(async () => {
	if (!enabled) return;
	await new Promise<void>((resolve) => server?.close(() => resolve()));
	await new Promise<void>((resolve) =>
		proxy ? proxy.close(() => resolve()) : resolve(),
	);
	if (process.env.GH_CAPTURE_FIXTURES === "1") await writeFixtures();
	if (work) await rm(work, { recursive: true, force: true });
});

/** One fixture per gh command: the documents it sent, host-independent. */
async function writeFixtures() {
	const dir = path.join(
		import.meta.dirname,
		"../../src/server/graphql/__fixtures__/gh",
	);
	const byFixture = new Map<
		string,
		{ command: string; requests: { query: string; variables?: unknown }[] }
	>();
	for (const { fixture, command, query, variables } of captured) {
		if (!fixture) continue;
		const entry = byFixture.get(fixture) ?? { command, requests: [] };
		const seen = entry.requests.some(
			(r) =>
				r.query === query &&
				JSON.stringify(r.variables) === JSON.stringify(variables),
		);
		if (!seen)
			entry.requests.push({
				query,
				...(variables !== undefined && { variables }),
			});
		byFixture.set(fixture, entry);
	}
	for (const [fixture, { command, requests }] of byFixture) {
		await writeFile(
			path.join(dir, `${fixture}.json`),
			`${JSON.stringify(
				{
					gh: GH_VERSION,
					command: command.replaceAll(host, "HOST").replaceAll(work, "WORK"),
					requests,
				},
				null,
				"\t",
			)}\n`,
		);
	}
}

describe.skipIf(!enabled)(
	`stock gh (${GH_VERSION}) against PushStack over loopback HTTPS`,
	() => {
		it("logs in with a token and reports the account", async () => {
			current = {
				fixture: "auth-login",
				command: "gh auth login --with-token --hostname HOST",
			};
			// --insecure-storage: the token stays in the scratch GH_CONFIG_DIR,
			// never the system keychain.
			await run(
				"sh",
				[
					"-c",
					'printf %s "$PAT" | gh auth login --with-token --insecure-storage --hostname "$HOST"',
				],
				{ env: { ...ghEnv, PAT, HOST: host } },
			);
			const { stdout, stderr } = await ghAs(
				"auth-status",
				"auth",
				"status",
				"--hostname",
				host,
			);
			const out = `${stdout}\n${stderr}`;
			expect(out).toMatch(/Logged in to .* account octo/);
			expect(out).not.toMatch(/missing required scope/i);
			expect((await gh("auth", "token", "--hostname", host)).stdout).toBe(PAT);
		});

		it("views a repository", async () => {
			const { stdout } = await ghAs(
				"repo-view",
				"repo",
				"view",
				`${host}/octo/hello`,
			);
			expect(stdout).toMatch(/octo\/hello/);
			expect(stdout).toMatch(/Hello from PushStack/);
			const json = await ghAs(
				"repo-view-json",
				"repo",
				"view",
				`${host}/octo/hello`,
				"--json",
				"name,nameWithOwner,owner,description,isPrivate,visibility,defaultBranchRef,url,viewerPermission,createdAt,isEmpty,stargazerCount,hasIssuesEnabled",
			);
			expect(JSON.parse(json.stdout)).toMatchObject({
				name: "hello",
				nameWithOwner: "octo/hello",
				owner: { login: "octo" },
				description: "Hello from PushStack",
				isPrivate: false,
				visibility: "PUBLIC",
				viewerPermission: "ADMIN",
				isEmpty: true,
				stargazerCount: 0,
				hasIssuesEnabled: true,
			});
		});

		it("reports a missing repository as gh does for GitHub", async () => {
			const out = await ghFails(
				"repo-view-missing",
				"repo",
				"view",
				`${host}/octo/missing`,
			);
			expect(out).toMatch(
				/Could not resolve to a Repository with the name 'octo\/missing'/,
			);
		});

		it("lists repositories", async () => {
			const { stdout } = await ghAs("repo-list", "repo", "list", "octo");
			expect(stdout).toMatch(/octo\/hello/);
			expect(stdout).toMatch(/octo\/hidden/);
			const json = await ghAs(
				"repo-list-json",
				"repo",
				"list",
				"octo",
				"--json",
				"nameWithOwner,isPrivate,description,visibility",
			);
			const repos = JSON.parse(json.stdout) as { nameWithOwner: string }[];
			expect(repos.map((r) => r.nameWithOwner).sort()).toEqual([
				"octo/hello",
				"octo/hidden",
			]);
			const visible = await ghAs(
				"repo-list-public",
				"repo",
				"list",
				"octo",
				"--visibility",
				"public",
				"--json",
				"name",
			);
			expect(JSON.parse(visible.stdout)).toEqual([{ name: "hello" }]);
		});

		it("clones over git smart HTTP at the GitHub clone URL", async () => {
			await ghAs(
				"repo-clone",
				"repo",
				"clone",
				`${host}/octo/hello`,
				path.join(work, "clone"),
			);
			const { stdout } = await run(
				"git",
				["-C", path.join(work, "clone"), "remote", "get-url", "origin"],
				{ env: ghEnv },
			);
			expect(stdout.trim()).toBe(`https://${host}/octo/hello.git`);
		});

		it("creates a repository", async () => {
			const { stdout, stderr } = await ghAs(
				"repo-create",
				"repo",
				"create",
				`${host}/octo/made-by-gh`,
				"--private",
				"--description",
				"From gh",
			);
			expect(`${stdout}\n${stderr}`).toMatch(/octo\/made-by-gh/);
			const view = await gh(
				"repo",
				"view",
				`${host}/octo/made-by-gh`,
				"--json",
				"isPrivate,description",
			);
			expect(JSON.parse(view.stdout)).toEqual({
				isPrivate: true,
				description: "From gh",
			});
		});

		it("opens, reviews, comments on, merges and closes pull requests", async () => {
			const repoDir = path.join(work, "pr-work");
			const git = (...args: string[]) =>
				run("git", ["-C", repoDir, ...args], { env: ghEnv });
			await gh("auth", "setup-git", "--hostname", host);
			await ghAs(
				"repo-clone-empty",
				"repo",
				"clone",
				`${host}/octo/hello`,
				repoDir,
			);
			await git("config", "user.name", "Octo");
			await git("config", "user.email", "octo@example.com");
			await git("checkout", "-b", "main");
			await writeFile(path.join(repoDir, "a.txt"), "a\n");
			await git("add", "a.txt");
			await git("commit", "-m", "first");
			await git("push", "origin", "main");
			const feature = async (branch: string, file: string) => {
				await git("checkout", "-b", branch, "main");
				await writeFile(path.join(repoDir, file), `${file}\n`);
				await git("add", file);
				await git("commit", "-m", `add ${file}`);
				await git("push", "origin", branch);
			};
			const repo = `${host}/octo/hello`;

			await feature("one", "one.txt");
			const created = await ghAs(
				"pr-create",
				"pr",
				"create",
				"-R",
				repo,
				"--head",
				"one",
				"--base",
				"main",
				"--title",
				"One",
				"--body",
				"First change",
			);
			expect(created.stdout).toMatch(/\/pull\/1$/);
			const view = await ghAs(
				"pr-view-json",
				"pr",
				"view",
				"1",
				"-R",
				repo,
				"--json",
				"additions,assignees,author,baseRefName,body,changedFiles,closed,closedAt,comments,commits,createdAt,deletions,files,headRefName,headRefOid,headRepository,headRepositoryOwner,id,isCrossRepository,isDraft,labels,latestReviews,maintainerCanModify,mergeCommit,mergeStateStatus,mergeable,mergedAt,mergedBy,milestone,number,projectItems,reactionGroups,reviewDecision,reviewRequests,reviews,state,statusCheckRollup,title,updatedAt,url",
			);
			expect(JSON.parse(view.stdout)).toMatchObject({
				number: 1,
				title: "One",
				state: "OPEN",
				headRefName: "one",
				baseRefName: "main",
				isCrossRepository: false,
			});
			expect(
				(await ghAs("pr-diff", "pr", "diff", "1", "-R", repo)).stdout,
			).toMatch(/one\.txt/);
			await ghAs(
				"pr-comment",
				"pr",
				"comment",
				"1",
				"-R",
				repo,
				"--body",
				"Hi",
			);
			await ghAs(
				"pr-review",
				"pr",
				"review",
				"1",
				"-R",
				repo,
				"--comment",
				"--body",
				"Looks fine",
			);
			await ghAs(
				"pr-edit",
				"pr",
				"edit",
				"1",
				"-R",
				repo,
				"--title",
				"One (edited)",
			);
			await ghAs("pr-merge", "pr", "merge", "1", "-R", repo, "--squash");
			const merged = await gh("pr", "view", "1", "-R", repo, "--json", "state");
			expect(JSON.parse(merged.stdout).state).toBe("MERGED");

			await feature("two", "two.txt");
			await ghAs(
				"pr-create-2",
				"pr",
				"create",
				"-R",
				repo,
				"--head",
				"two",
				"--base",
				"main",
				"--title",
				"Two",
				"--body",
				"",
			);
			await ghAs("pr-close", "pr", "close", "2", "-R", repo);
			await ghAs("pr-reopen", "pr", "reopen", "2", "-R", repo);
			await ghAs("pr-close-2", "pr", "close", "2", "-R", repo);
		}, 120_000);

		it("enforces branch protection on a merge and a force push", async () => {
			const repo = `${host}/octo/hello`;
			const repoDir = path.join(work, "protected-work");
			const git = (...args: string[]) =>
				run("git", ["-C", repoDir, ...args], { env: ghEnv });
			const gitFails = async (...args: string[]) => {
				try {
					await git(...args);
				} catch (error) {
					const failed = error as { stdout?: string; stderr?: string };
					return `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
				}
				throw new Error(`git ${args.join(" ")} unexpectedly succeeded`);
			};
			await gh("auth", "setup-git", "--hostname", host);
			await gh("repo", "clone", repo, repoDir);
			await git("config", "user.name", "Octo");
			await git("config", "user.email", "octo@example.com");
			await git("checkout", "-B", "main", "origin/main");
			await git("checkout", "-b", "guarded");
			await writeFile(path.join(repoDir, "guarded.txt"), "guarded\n");
			await git("add", "guarded.txt");
			await git("commit", "-m", "add guarded");
			await git("push", "origin", "guarded");

			const created = await gh(
				"pr",
				"create",
				"-R",
				repo,
				"--head",
				"guarded",
				"--base",
				"main",
				"--title",
				"Guarded",
				"--body",
				"",
			);
			const number = /\/pull\/(\d+)/.exec(created.stdout)?.[1] as string;

			const rule = path.join(work, "protection.json");
			await writeFile(
				rule,
				JSON.stringify({
					required_pull_request_reviews: { required_approving_review_count: 1 },
					required_status_checks: { strict: false, contexts: ["ci"] },
					enforce_admins: true,
				}),
			);
			const saved = await gh(
				"api",
				"--hostname",
				host,
				"-X",
				"PUT",
				"repos/octo/hello/branches/main/protection",
				"--input",
				rule,
			);
			expect(JSON.parse(saved.stdout)).toMatchObject({
				required_status_checks: { contexts: ["ci"] },
				required_pull_request_reviews: {
					required_approving_review_count: 1,
				},
				enforce_admins: { enabled: true },
			});
			const read = await gh(
				"api",
				"--hostname",
				host,
				"repos/octo/hello/branches/main/protection",
			);
			expect(JSON.parse(read.stdout).required_status_checks.contexts).toEqual([
				"ci",
			]);

			const fields = ["mergeStateStatus", "reviewDecision"];
			const blocked = await gh(
				"pr",
				"view",
				number,
				"-R",
				repo,
				"--json",
				fields.join(","),
			);
			expect(JSON.parse(blocked.stdout)).toEqual({
				mergeStateStatus: "BLOCKED",
				reviewDecision: "REVIEW_REQUIRED",
			});
			const refused = await ghFails(
				"pr-merge-blocked",
				"pr",
				"merge",
				number,
				"-R",
				repo,
				"--squash",
			);
			expect(refused).toMatch(/not mergeable/);
			const status = await gh("pr", "status", "-R", repo);
			expect(status.stdout).toContain(`#${number}`);

			// A second reviewer's approval, as their own gh session would record it.
			const headSha = (await git("rev-parse", "HEAD")).stdout.trim();
			const { db } = await import("#/db");
			const { user } = await import("../../src/db/schema");
			const { pullRequestReviews } = await import("../../src/db/app-schema");
			const { findRepositoryByName } = await import(
				"../../src/server/repository-lookup"
			);
			const { findPullRequestByNumber } = await import(
				"../../src/server/thread-store"
			);
			const reviewer = {
				id: "gh_smoke_reviewer",
				username: "reviewer",
				email: "reviewer@example.com",
				name: "Reviewer",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			await db.insert(user).values(reviewer).onConflictDoNothing();
			const repository = await findRepositoryByName("octo", "hello");
			if (!repository) throw new Error("smoke repository missing");
			const pull = await findPullRequestByNumber(repository.id, Number(number));
			if (!pull) throw new Error("smoke pull request missing");
			await db.insert(pullRequestReviews).values({
				repoId: repository.id,
				pullRequestId: pull.id,
				authorId: reviewer.id,
				state: "approved",
				commitSha: headSha,
				submittedAt: new Date(),
			});

			const approved = await gh(
				"pr",
				"view",
				number,
				"-R",
				repo,
				"--json",
				fields.join(","),
			);
			expect(JSON.parse(approved.stdout)).toEqual({
				mergeStateStatus: "UNSTABLE",
				reviewDecision: "APPROVED",
			});
			await gh(
				"api",
				"--hostname",
				host,
				`repos/octo/hello/statuses/${headSha}`,
				"-f",
				"state=success",
				"-f",
				"context=ci",
			);
			const clean = await gh(
				"pr",
				"view",
				number,
				"-R",
				repo,
				"--json",
				fields.join(","),
			);
			expect(JSON.parse(clean.stdout)).toEqual({
				mergeStateStatus: "CLEAN",
				reviewDecision: "APPROVED",
			});
			await gh("pr", "merge", number, "-R", repo, "--squash");
			const merged = await gh(
				"pr",
				"view",
				number,
				"-R",
				repo,
				"--json",
				"state",
			);
			expect(JSON.parse(merged.stdout).state).toBe("MERGED");

			await git("fetch", "origin", "main");
			await git("checkout", "-B", "main", "origin/main");
			await git("reset", "--hard", "HEAD~1");
			const forced = await gitFails("push", "--force", "origin", "main");
			expect(forced).toContain(
				"remote: error: GH006: Protected branch update failed for refs/heads/main.",
			);

			await gh(
				"api",
				"--hostname",
				host,
				"-X",
				"DELETE",
				"repos/octo/hello/branches/main/protection",
			);
		}, 120_000);

		it("creates, comments on, closes and reopens issues, and manages labels", async () => {
			const repo = `${host}/octo/hello`;
			for (const title of ["v1", "v2"]) {
				await gh(
					"api",
					"--hostname",
					host,
					"repos/octo/hello/milestones",
					"-f",
					`title=${title}`,
				);
			}
			await ghAs(
				"label-create",
				"label",
				"create",
				"-R",
				repo,
				"bug",
				"--color",
				"d73a4a",
				"--force",
			);
			await ghAs(
				"issue-comment",
				"issue",
				"comment",
				"1",
				"-R",
				repo,
				"--body",
				"Noted",
			).catch(() => undefined);
			const made = await ghAs(
				"issue-create-2",
				"issue",
				"create",
				"-R",
				repo,
				"--title",
				"Broken",
				"--body",
				"It broke",
				"--label",
				"bug",
			);
			const number = /\/issues\/(\d+)/.exec(made.stdout)?.[1] as string;
			await ghAs(
				"issue-comment-2",
				"issue",
				"comment",
				number,
				"-R",
				repo,
				"--body",
				"Noted",
			);
			await ghAs(
				"issue-edit",
				"issue",
				"edit",
				number,
				"-R",
				repo,
				"--title",
				"Broken!",
			);
			await ghAs("issue-close", "issue", "close", number, "-R", repo);
			await ghAs("issue-reopen", "issue", "reopen", number, "-R", repo);
			const listed = await gh(
				"issue",
				"list",
				"-R",
				repo,
				"--state",
				"all",
				"--json",
				"number,title,state,labels",
			);
			expect(JSON.parse(listed.stdout)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						number: Number(number),
						title: "Broken!",
						state: "OPEN",
					}),
				]),
			);
			const viewed = await ghAs(
				"issue-view-comments",
				"issue",
				"view",
				number,
				"-R",
				repo,
				"--comments",
			);
			expect(viewed.stdout).toMatch(/Noted/);
			await ghAs("label-delete", "label", "delete", "bug", "-R", repo, "--yes");
		}, 120_000);

		it("sets milestones on issues by title", async () => {
			const repo = `${host}/octo/hello`;
			const made = await ghAs(
				"issue-create-milestone",
				"issue",
				"create",
				"-R",
				repo,
				"--title",
				"Milestoned",
				"--body",
				"In a milestone",
				"--milestone",
				"v1",
			);
			const number = /\/issues\/(\d+)/.exec(made.stdout)?.[1] as string;
			await ghAs(
				"issue-edit-milestone",
				"issue",
				"edit",
				number,
				"-R",
				repo,
				"--milestone",
				"v2",
			);
			const listed = await ghAs(
				"issue-list-milestone",
				"issue",
				"list",
				"-R",
				repo,
				"--milestone",
				"v2",
				"--json",
				"number,title,milestone",
			);
			expect(JSON.parse(listed.stdout)).toEqual([
				expect.objectContaining({
					number: Number(number),
					title: "Milestoned",
					milestone: expect.objectContaining({ number: 2, title: "v2" }),
				}),
			]);
		}, 120_000);

		it("creates, lists, views, edits, clones and deletes a gist", async () => {
			const file = path.join(work, "smoke-gist.txt");
			await writeFile(file, "gist smoke contents\n");
			const created = await ghAs(
				"gist-create",
				"gist",
				"create",
				file,
				"--public",
				"--desc",
				"Smoke gist",
			);
			const url = created.stdout.split("\n").filter(Boolean).at(-1) ?? "";
			const id = url.split("/").at(-1) ?? "";
			expect(id).toMatch(/^[0-9a-f]{32}$/);

			const listed = await ghAs("gist-list", "gist", "list", "--limit", "10");
			expect(listed.stdout).toContain(id.slice(0, 8));
			expect(listed.stdout).toContain("Smoke gist");

			const view = await ghAs("gist-view", "gist", "view", id, "--raw");
			expect(view.stdout).toContain("gist smoke contents");

			const added = path.join(work, "added.txt");
			await writeFile(added, "added later\n");
			await ghAs(
				"gist-edit",
				"gist",
				"edit",
				id,
				"--add",
				added,
				"--desc",
				"Edited gist",
			);
			const files = await ghAs(
				"gist-view-files",
				"gist",
				"view",
				id,
				"--files",
			);
			expect(files.stdout).toContain("added.txt");

			await ghAs(
				"gist-clone",
				"gist",
				"clone",
				id,
				path.join(work, "gist-clone"),
			);
			expect(
				await readFile(path.join(work, "gist-clone", "smoke-gist.txt"), "utf8"),
			).toBe("gist smoke contents\n");

			await ghAs("gist-delete", "gist", "delete", id, "--yes");
			const gone = await ghFails("gist-view-missing", "gist", "view", id);
			expect(gone).toMatch(/not found|404/i);
		});

		it("creates a project, a field and an item, and sets a field value", async () => {
			const repo = `${host}/octo/hello`;
			const issue = await ghAs(
				"project-issue",
				"issue",
				"create",
				"-R",
				repo,
				"--title",
				"Planned",
				"--body",
				"On the board",
			);
			const issueUrl = issue.stdout.trim();
			const created = await ghAs(
				"project-create",
				"project",
				"create",
				"--owner",
				"octo",
				"--title",
				"Roadmap",
				"--format",
				"json",
			);
			const project = JSON.parse(created.stdout);
			expect(project).toMatchObject({ title: "Roadmap", public: false });
			const number = String(project.number);

			const field = await ghAs(
				"project-field-create",
				"project",
				"field-create",
				number,
				"--owner",
				"octo",
				"--name",
				"Notes",
				"--data-type",
				"TEXT",
				"--format",
				"json",
			);
			expect(JSON.parse(field.stdout)).toMatchObject({ name: "Notes" });

			const added = await ghAs(
				"project-item-add",
				"project",
				"item-add",
				number,
				"--owner",
				"octo",
				"--url",
				issueUrl,
				"--format",
				"json",
			);
			expect(JSON.parse(added.stdout)).toMatchObject({
				title: "Planned",
				type: "Issue",
			});

			await ghAs(
				"project-item-edit",
				"project",
				"item-edit",
				number,
				"--owner",
				"octo",
				"--url",
				issueUrl,
				"--field",
				"Notes",
				"--text",
				"Ready",
			);
			const listed = await ghAs(
				"project-item-list",
				"project",
				"item-list",
				number,
				"--owner",
				"octo",
				"--format",
				"json",
				"--limit",
				"10",
			);
			expect(JSON.parse(listed.stdout).items[0]).toMatchObject({
				content: { title: "Planned" },
				notes: "Ready",
			});
		}, 120_000);

		it("calls the REST API, which reports the token's classic scopes", async () => {
			const { stdout } = await gh("api", "--hostname", host, "user");
			expect(JSON.parse(stdout).login).toBe("octo");
			const included = await gh("api", "--hostname", host, "--include", "/");
			expect(included.stdout).toMatch(
				/^X-Oauth-Scopes: gist, read:org, repo$/im,
			);
		});

		// Not served yet (issues/pulls domains): with GH_CAPTURE_FIXTURES=1 this
		// records the first document each command sends, so the fixtures exist
		// before the resolvers do. gh stops at the first error, so later
		// requests of a command are captured once its first one is served.
		it.runIf(process.env.GH_CAPTURE_FIXTURES === "1")(
			"captures the documents of commands not served yet",
			async () => {
				const repo = `${host}/octo/hello`;
				const pending: [string, ...string[]][] = [
					["issue-list", "issue", "list", "-R", repo],
					["issue-view", "issue", "view", "1", "-R", repo],
					[
						"issue-create",
						"issue",
						"create",
						"-R",
						repo,
						"--title",
						"T",
						"--body",
						"B",
					],
					["issue-status", "issue", "status", "-R", repo],
					["pr-list", "pr", "list", "-R", repo],
					["pr-view", "pr", "view", "1", "-R", repo],
					["pr-status", "pr", "status", "-R", repo],
					["label-list", "label", "list", "-R", repo],
				];
				for (const [fixture, ...args] of pending) {
					await ghAs(fixture, ...args).catch(() => undefined);
				}
			},
		);

		it("creates a discussion and marks an answer with gh api graphql", async () => {
			const setup = JSON.parse(
				(
					await ghAs(
						"discussion-setup",
						"api",
						"graphql",
						"-f",
						`query=query Setup($owner: String!, $name: String!) {
							repository(owner: $owner, name: $name) {
								id
								discussionCategories(first: 10) {
									nodes { id slug isAnswerable }
								}
							}
						}`,
						"-f",
						"owner=octo",
						"-f",
						"name=hello",
					)
				).stdout,
			).data.repository;
			const qa = setup.discussionCategories.nodes.find(
				(node: { isAnswerable: boolean }) => node.isAnswerable,
			) as { id: string } | undefined;
			if (!qa) throw new Error("octo/hello has no Q&A category");
			const created = JSON.parse(
				(
					await ghAs(
						"discussion-create",
						"api",
						"graphql",
						"-f",
						`query=mutation {
							createDiscussion(input: {
								repositoryId: "${setup.id}",
								categoryId: "${qa.id}",
								title: "A smoke question",
								body: "Does this work?"
							}) { discussion { id number title isAnswered } }
						}`,
					)
				).stdout,
			);
			expect(created.errors).toBeUndefined();
			const discussion = created.data.createDiscussion.discussion;
			expect(discussion.isAnswered).toBe(false);
			expect(discussion.number).toBeGreaterThan(0);

			const commented = JSON.parse(
				(
					await ghAs(
						"discussion-comment",
						"api",
						"graphql",
						"-f",
						`query=mutation {
							addDiscussionComment(input: {
								discussionId: "${discussion.id}",
								body: "It does."
							}) { comment { id body } }
						}`,
					)
				).stdout,
			);
			expect(commented.errors).toBeUndefined();
			const comment = commented.data.addDiscussionComment.comment;

			const answered = JSON.parse(
				(
					await ghAs(
						"discussion-answer",
						"api",
						"graphql",
						"-f",
						`query=mutation {
							markDiscussionCommentAsAnswer(input: { id: "${comment.id}" }) {
								discussion { isAnswered }
							}
						}`,
					)
				).stdout,
			);
			expect(answered.errors).toBeUndefined();
			expect(answered.data.markDiscussionCommentAsAnswer.discussion).toEqual({
				isAnswered: true,
			});
		});

		it("calls the GraphQL API, with --paginate", async () => {
			const { stdout } = await ghAs(
				"api-graphql-paginate",
				"api",
				"graphql",
				"--hostname",
				host,
				"--paginate",
				"-f",
				"query=query($endCursor: String) { viewer { repositories(first: 1, after: $endCursor, orderBy: {field: NAME, direction: ASC}) { nodes { name } pageInfo { hasNextPage endCursor } } } }",
				"--jq",
				".data.viewer.repositories.nodes[].name",
			);
			expect(stdout.split("\n")).toEqual(["hello", "hidden", "made-by-gh"]);
		});
	},
);
