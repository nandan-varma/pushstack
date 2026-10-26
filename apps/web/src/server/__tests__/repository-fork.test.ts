/**
 * @vitest-environment node
 *
 * A fork is a server-side copy of its parent's git prefix on R2 (the fake S3
 * here, so the `CopyObject` path runs). These tests pin what the copy means:
 * the fork clones with the parent's refs and history, moves independently of
 * it, and survives the parent's deletion.
 */
import fs, { promises as nodeFs } from "node:fs";
import type { HttpClient } from "isomorphic-git";
import git from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENV = vi.hoisted(() => {
	const os = require("node:os");
	const path = require("node:path");
	const base = path.join(os.tmpdir(), `pushstack-fork-${Date.now()}`);
	process.env.R2_BUCKET_NAME = "test-bucket";
	process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "test-key";
	process.env.R2_SECRET_ACCESS_KEY = "test-secret";
	return { base, cloneDir: path.join(base, "clone") };
});

const fakeS3 = vi.hoisted(() => ({
	objects: new Map<string, Uint8Array>(),
}));

vi.mock("#/lib/r2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/r2")>();
	const { createFetchS3Store } = await import("git-fs-s3/fetch-s3");
	const { createFakeS3 } = await import("git-fs-s3/testing");
	const s3 = createFakeS3({ bucket: "test-bucket" });
	fakeS3.objects = s3.objects;
	return {
		...actual,
		createR2ObjectStoreFromEnv: (
			contentType?: (key: string) => string | undefined,
		) =>
			createFetchS3Store({
				endpoint: "https://test-account.r2.cloudflarestorage.com",
				bucket: "test-bucket",
				accessKeyId: "test-key",
				secretAccessKey: "test-secret",
				contentType,
				fetch: s3.fetch,
			}),
	};
});

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("forker", "parentowner");
const { db } = await import("#/db");
const { repoFor } = await import("../git-repo");
const { createCommit, createBranch } = await import("../git-write");
const { createRef } = await import("../git-objects");
const { createRepositoryForUser, RepositoryExistsError } = await import(
	"../repository-create"
);
const { forkRepositoryForUser } = await import("../repository-fork");
const { deleteRepositoryAndStorage } = await import("../repository-settings");
const { serveGitRequest } = await import("../git-http");
const { findRepositoryByName } = await import("../repository-lookup");

/** isomorphic-git's transport, answered by the git handler in this process. */
const inProcessHttp: HttpClient = {
	async request({ url, method = "GET", headers = {}, body }) {
		const chunks: Buffer[] = [];
		if (body) for await (const chunk of body) chunks.push(Buffer.from(chunk));
		const response = await serveGitRequest(
			new Request(url, {
				method,
				headers,
				body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
			}),
		);
		return {
			url,
			method,
			statusCode: response.status,
			statusMessage: response.statusText,
			headers: Object.fromEntries(response.headers),
			body: (async function* () {
				yield new Uint8Array(await response.arrayBuffer());
			})(),
		};
	},
};

const gitUrl = (owner: string, name: string) =>
	`http://git.test/${owner}/${name}.git`;

async function refShas(ownerKey: string, name: string) {
	const repo = repoFor(ownerKey, name);
	const branches = await git.listBranches({ ...repo });
	const shas: Record<string, string> = {};
	for (const branch of branches) {
		shas[`heads/${branch}`] = await git.resolveRef({
			...repo,
			ref: `refs/heads/${branch}`,
		});
	}
	const tags = await git.listTags({ ...repo });
	for (const tag of tags) {
		shas[`tags/${tag}`] = await git.resolveRef({
			...repo,
			ref: `refs/tags/${tag}`,
		});
	}
	return shas;
}

async function parentWithHistory(name: string) {
	await createRepositoryForUser(users.parentowner, {
		name,
		visibility: "public",
		autoInit: false,
		description: "the original",
	});
	const author = { name: "Parent Owner", email: "parentowner@example.com" };
	await createCommit("parentowner", name, {
		branch: "main",
		message: "first",
		files: [{ path: "README.md", content: "one\n" }],
		author,
	});
	await createCommit("parentowner", name, {
		branch: "main",
		message: "second",
		files: [{ path: "src/a.txt", content: "two\n" }],
		author,
	});
	await createBranch("parentowner", name, "topic", "main");
	await createCommit("parentowner", name, {
		branch: "topic",
		message: "topic work",
		files: [{ path: "topic.txt", content: "t\n" }],
		author,
	});
	await createRef(
		"parentowner",
		name,
		"refs/tags/v1",
		(await refShas("parentowner", name))["heads/main"] ?? "",
	);
}

async function parentRow(name: string) {
	const row = await findRepositoryByName("parentowner", name);
	if (!row) throw new Error(`no parent ${name}`);
	return row;
}

beforeAll(async () => {
	await parentWithHistory("upstream");
});

afterAll(async () => {
	await nodeFs.rm(ENV.base, { recursive: true, force: true }).catch(() => {});
});

describe("forking a repository", () => {
	it("records the fork's parent, visibility and default branch", async () => {
		const parent = await parentRow("upstream");
		const fork = await forkRepositoryForUser(parent, users.forker, "upstream");

		expect(fork).toMatchObject({
			name: "upstream",
			ownerId: users.forker.id,
			isFork: true,
			forkOfId: parent.id,
			visibility: "public",
			defaultBranch: "main",
			description: "the original",
		});
	});

	it("copies every branch and tag, with the same shas as the parent", async () => {
		expect(await refShas("forker", "upstream")).toEqual(
			await refShas("parentowner", "upstream"),
		);
	});

	it("clones with the parent's history and HEAD", async () => {
		await nodeFs.rm(ENV.cloneDir, { recursive: true, force: true });
		await git.clone({
			fs,
			http: inProcessHttp,
			dir: ENV.cloneDir,
			url: gitUrl("forker", "upstream"),
			ref: "main",
			singleBranch: false,
		});
		const log = await git.log({ fs, dir: ENV.cloneDir, ref: "main" });
		expect(log.map((entry) => entry.commit.message.trim())).toEqual([
			"second",
			"first",
		]);
		expect(await git.resolveRef({ fs, dir: ENV.cloneDir, ref: "v1" })).toBe(
			(await refShas("parentowner", "upstream"))["heads/main"],
		);
	});

	it("moves independently: a push to the fork leaves the parent untouched", async () => {
		const before = await refShas("parentowner", "upstream");
		await createCommit("forker", "upstream", {
			branch: "main",
			message: "fork only",
			files: [{ path: "fork-only.txt", content: "f\n" }],
			author: { name: "Forker", email: "forker@example.com" },
		});
		expect(await refShas("parentowner", "upstream")).toEqual(before);
		expect((await refShas("forker", "upstream"))["heads/main"]).not.toBe(
			before["heads/main"],
		);
	});

	it("keeps the fork cloneable after the parent is deleted, with fork: true", async () => {
		const parent = await parentRow("upstream");
		const forkBefore = await findRepositoryByName("forker", "upstream");
		expect(forkBefore?.forkOfId).toBe(parent.id);

		await deleteRepositoryAndStorage(
			await db.query.repositories
				.findFirst({
					where: { id: parent.id },
					with: { owner: { columns: { id: true, username: true } } },
				})
				.then((row) => {
					if (!row) throw new Error("parent vanished");
					return row;
				}),
		);

		// The row, not the by-name cache: that cache is not evicted when a parent
		// goes, and the row is what the database now holds.
		const fork = await db.query.repositories.findFirst({
			where: { ownerId: users.forker.id, name: "upstream" },
		});
		expect(fork).toMatchObject({ isFork: true, forkOfId: null });
		const branches = await git.listBranches({
			...repoFor("forker", "upstream"),
		});
		expect(branches).toContain("main");
		expect(branches).toContain("topic");
		await nodeFs.rm(ENV.cloneDir, { recursive: true, force: true });
		await git.clone({
			fs,
			http: inProcessHttp,
			dir: ENV.cloneDir,
			url: gitUrl("forker", "upstream"),
			ref: "main",
		});
		expect(
			await fs.promises.readFile(`${ENV.cloneDir}/fork-only.txt`, "utf8"),
		).toBe("f\n");
	});

	it("answers the existing fork when the same parent is forked under the same name again", async () => {
		const parent = await createRepositoryForUser(users.parentowner, {
			name: "again",
			visibility: "public",
			autoInit: false,
		});
		await createCommit("parentowner", "again", {
			branch: "main",
			message: "root",
			files: [{ path: "a", content: "a\n" }],
			author: { name: "P", email: "parentowner@example.com" },
		});
		const first = await forkRepositoryForUser(
			{
				...parent,
				owner: { id: users.parentowner.id, username: "parentowner" },
			},
			users.forker,
			"again",
		);
		const second = await forkRepositoryForUser(
			{
				...parent,
				owner: { id: users.parentowner.id, username: "parentowner" },
			},
			users.forker,
			"again",
		);
		expect(second.id).toBe(first.id);
	});

	it("refuses a name the owner already uses for another repository", async () => {
		await createRepositoryForUser(users.forker, {
			name: "taken",
			visibility: "public",
			autoInit: false,
		});
		const solo = await createRepositoryForUser(users.parentowner, {
			name: "solo",
			visibility: "public",
			autoInit: false,
		});
		await expect(
			forkRepositoryForUser(
				{
					...solo,
					owner: { id: users.parentowner.id, username: "parentowner" },
				},
				users.forker,
				"taken",
			),
		).rejects.toBeInstanceOf(RepositoryExistsError);
	});
});
