/**
 * @vitest-environment node
 *
 * Wiki git over HTTP (#392): `/{owner}/{repo}.wiki.git` clones and pushes
 * through the real dispatcher on pglite + the in-memory git store. Who may
 * push is the wiki edit policy (a collaborator, or a signed-in user on a
 * public wiki unless restricted), and a wiki push runs none of a repository's
 * post-push bookkeeping.
 */
import { createGitFs, MemoryObjectStore } from "git-fs-s3";
import { pktLine } from "git-fs-s3/http";
import git from "isomorphic-git";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob", "carol");
const { call, mintToken, post } = await import("../../test/api-client");
const { serveGitRequest } = await import("../git-http");
const { gitFs } = await import("../git-fs");
const { repoFor } = await import("../git-repo");
const { getRepoWikiGitStorageRoot } = await import("../git-storage-naming");
const { findRepositoryByName } = await import("../repository-lookup");
const { addCollaboratorByUsername } = await import("../repositories");
const { getBlob, getTreeFromRef } = await import("git-fs-s3/ops");

const BASE = "http://localhost:3000";
const ZERO_OID = "0".repeat(40);

let alice: string;
let bob: string;
let carol: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "pub" }));
	const pub = await findRepositoryByName("alice", "pub");
	if (!pub) throw new Error("repository missing");
	signIn(users.alice);
	await addCollaboratorByUsername({
		data: { repoId: pub.id, username: "carol", role: "write" },
	});
	await call(
		"/user/repos",
		post(alice, { name: "secret", private: true, auto_init: true }),
	);
	await call("/user/repos", post(alice, { name: "off", has_wiki: false }));
});

const stagingFs = createGitFs(new MemoryObjectStore());
const author = {
	name: "Test",
	email: "test@example.com",
	timestamp: Math.floor(Date.now() / 1000),
	timezoneOffset: 0,
};

/** A real packfile for one commit adding `files`, as `git push` sends it. */
async function pushBody(
	files: Record<string, string>,
	message: string,
	parentOid?: string,
): Promise<{ body: Uint8Array<ArrayBuffer>; commitOid: string }> {
	const staging = { fs: stagingFs, gitdir: "staging", cache: {} };
	await git.init({
		...staging,
		dir: staging.gitdir,
		bare: true,
		defaultBranch: "master",
	});
	const tree: Array<{
		path: string;
		mode: string;
		type: "blob";
		oid: string;
	}> = [];
	for (const [path, content] of Object.entries(files)) {
		const oid = await git.writeBlob({
			...staging,
			blob: new TextEncoder().encode(content),
		});
		tree.push({ path, mode: "100644", type: "blob", oid });
	}
	const treeOid = await git.writeTree({ ...staging, tree });
	const commitOid = await git.writeCommit({
		...staging,
		commit: {
			message,
			tree: treeOid,
			parent: parentOid ? [parentOid] : [],
			author,
			committer: author,
		},
	});
	const { packfile } = await git.packObjects({
		...staging,
		oids: [...tree.map((entry) => entry.oid), treeOid, commitOid],
	});
	const command = pktLine(
		`${parentOid ?? ZERO_OID} ${commitOid} refs/heads/master\n`,
	);
	const end = new TextEncoder().encode("0000");
	const pack = packfile ?? new Uint8Array();
	const body = new Uint8Array(command.length + end.length + pack.length);
	body.set(command);
	body.set(end, command.length);
	body.set(pack, command.length + end.length);
	return { body, commitOid };
}

function pushRequest(
	owner: string,
	repo: string,
	token: string | null,
	body: Uint8Array<ArrayBuffer>,
) {
	return serveGitRequest(
		new Request(`${BASE}/${owner}/${repo}.wiki.git/git-receive-pack`, {
			method: "POST",
			headers: {
				"content-type": "application/x-git-receive-pack-request",
				...(token && { authorization: `Basic ${btoa(`u:${token}`)}` }),
			},
			body: new Blob([body]),
		}),
	);
}

const infoRefs = (owner: string, repo: string, token: string | null) =>
	serveGitRequest(
		new Request(
			`${BASE}/${owner}/${repo}.wiki.git/info/refs?service=git-upload-pack`,
			{
				headers: token ? { authorization: `Basic ${btoa(`u:${token}`)}` } : {},
			},
		),
	);

describe("wiki clone and push", () => {
	it("lets a collaborator push Home.md and serves it anonymously", async () => {
		const url = await infoRefs("alice", "pub", null);
		expect(url.status).toBe(200);
		expect(await url.text()).toContain("refs/heads/master");

		const { body, commitOid } = await pushBody(
			{ "Home.md": "# Home\n" },
			"Create Home",
		);
		const pushed = await pushRequest("alice", "pub", carol, body);
		expect(pushed.status).toBe(200);

		const advertised = await infoRefs("alice", "pub", null);
		expect(advertised.status).toBe(200);
		const text = await advertised.text();
		expect(text).toContain("refs/heads/master");
		expect(text).toContain(commitOid);

		// The bytes the anonymous clone would fetch are Home.md's.
		const wiki = repoFor("alice", "pub", "wiki");
		const entries = await getTreeFromRef(wiki, { ref: "refs/heads/master" });
		const home = entries.find((entry) => entry.path === "Home.md");
		if (!home) throw new Error("Home.md missing from the wiki tree");
		expect(new TextDecoder().decode(await getBlob(wiki, home.oid))).toBe(
			"# Home\n",
		);
	});

	it("refuses a non-collaborator's push to a private wiki", async () => {
		const { body } = await pushBody({ "Home.md": "# Secret\n" }, "Create Home");
		expect((await pushRequest("alice", "secret", bob, body)).status).toBe(403);
	});

	it("lets a signed-in user push to a public wiki unless it is restricted", async () => {
		const first = await pushBody({ "Home.md": "# Public\n" }, "First page");
		expect((await pushRequest("alice", "pub", bob, first.body)).status).toBe(
			200,
		);

		const repo = await findRepositoryByName("alice", "pub");
		if (!repo) throw new Error("repository missing");
		signIn(users.alice);
		const { updateRepository } = await import("../repositories");
		await updateRepository({ data: { id: repo.id, wikiEditRestricted: true } });

		const second = await pushBody(
			{ "Home.md": "# Public again\n" },
			"Second page",
			first.commitOid,
		);
		expect((await pushRequest("alice", "pub", bob, second.body)).status).toBe(
			403,
		);
	});

	it("runs no repository post-push bookkeeping", async () => {
		const issue = await call(
			"/repos/alice/pub/issues",
			post(alice, { title: "Open" }),
		);
		expect(issue.status).toBe(201);
		const wiki = repoFor("alice", "pub", "wiki");
		const head = await git.resolveRef({ ...wiki, ref: "refs/heads/master" });
		const { body, commitOid } = await pushBody(
			{ "Closing.md": "Fixes #1\n" },
			"Fixes #1",
			head,
		);
		expect((await pushRequest("alice", "pub", carol, body)).status).toBe(200);
		expect(await git.resolveRef({ ...wiki, ref: "refs/heads/master" })).toBe(
			commitOid,
		);

		const after = await call("/repos/alice/pub/issues/1");
		expect(after.body.state).toBe("open");
		expect(after.body.closed_at).toBeNull();
		// No pull head either: a wiki has no pull requests.
		await expect(
			gitFs.promises.stat(
				`${getRepoWikiGitStorageRoot("alice", "pub")}/refs/pull`,
			),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("answers 404 for both info/refs and receive-pack when has_wiki is off", async () => {
		expect((await infoRefs("alice", "off", null)).status).toBe(404);
		const { body } = await pushBody({ "Home.md": "# No\n" }, "No");
		expect((await pushRequest("alice", "off", alice, body)).status).toBe(404);
	});
});
