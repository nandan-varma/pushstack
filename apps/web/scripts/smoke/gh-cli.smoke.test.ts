/**
 * @vitest-environment node
 *
 * Real-gh smoke test: the stock GitHub CLI against the app's real route
 * handlers (`/api/v3/$`, `/api/graphql`, `/api/git/$`) over pglite and an
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
		scopes: ["repo:write"],
	});

	const routes = {
		"/api/v3/": handlersOf((await import("../../src/routes/api/v3.$")).Route),
		"/api/graphql": handlersOf(
			(await import("../../src/routes/api/graphql")).Route,
		),
		"/api/git/": handlersOf((await import("../../src/routes/api/git.$")).Route),
	};

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
		const handler = prefix && routes[prefix][req.method ?? "GET"];
		const response = handler
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

		it("clone resolves the repository and hands git its GitHub clone URL", async () => {
			// Git at https://HOST/{owner}/{repo}.git is #206; until it lands the
			// clone itself fails after gh's RepositoryInfo lookup succeeded.
			const out = await ghFails(
				"repo-clone",
				"repo",
				"clone",
				`${host}/octo/hello`,
				path.join(work, "clone"),
			);
			expect(out).toContain(`https://${host}/octo/hello.git`);
			expect(out).not.toMatch(/GraphQL|Could not resolve to/);
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

		it("calls the REST API, which reports the token's classic scopes", async () => {
			const { stdout } = await gh("api", "--hostname", host, "user");
			expect(JSON.parse(stdout).login).toBe("octo");
			const included = await gh("api", "--hostname", host, "--include", "/");
			expect(included.stdout).toMatch(/^X-Oauth-Scopes: read:org, repo$/im);
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
