import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { handleInfoRefs } from "../src/http/info-refs.js";
import { pktLine } from "../src/http/pkt-line.js";
import {
	applyReceivePack,
	parseReceivePackBody,
} from "../src/http/receive-pack.js";
import {
	createGitFs,
	MemoryObjectStore,
	pullHeadRefName,
} from "../src/index.js";
import {
	authorNow,
	commitFilesToBare,
	listPullHeadRefNames,
	type Repo,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");
const ZERO_OID = "0".repeat(40);

function makeRepo(): Repo {
	return {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "repos/alice/blog/git",
		cache: {},
	};
}

/** The same filesystem, with its recursive lister hidden (the walk fallback). */
function withoutRecursiveLister(repo: Repo): Repo {
	const fs = new Proxy(repo.fs, {
		has: (target, key) =>
			key === "listFilesRecursively" ? false : Reflect.has(target, key),
		get: (target, key) =>
			key === "listFilesRecursively" ? undefined : Reflect.get(target, key),
	});
	return { ...repo, fs };
}

async function repoWithPull() {
	const repo = makeRepo();
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const main = await commitFilesToBare(repo, {
		branch: "main",
		message: "main\n",
		author,
		files: [{ path: "a.txt", content: "a\n" }],
	});
	const pr = await commitFilesToBare(repo, {
		branch: "topic",
		message: "topic\n",
		author,
		files: [{ path: "b.txt", content: "b\n" }],
	});
	await git.writeRef({ ...repo, ref: pullHeadRefName(7), value: pr });
	await git.writeRef({ ...repo, ref: pullHeadRefName(12), value: pr });
	return { repo, main, pr };
}

describe("listPullHeadRefNames", () => {
	it("lists every pull head ref, from the recursive lister", async () => {
		const { repo } = await repoWithPull();
		expect(await listPullHeadRefNames(repo)).toEqual([
			"refs/pull/12/head",
			"refs/pull/7/head",
		]);
	});

	it("lists the same refs through isomorphic-git's walk", async () => {
		const { repo } = await repoWithPull();
		expect(await listPullHeadRefNames(withoutRecursiveLister(repo))).toEqual(
			await listPullHeadRefNames(repo),
		);
	});

	it("is empty when no pull request has a head ref", async () => {
		const repo = makeRepo();
		await git.init({
			...repo,
			dir: repo.gitdir,
			bare: true,
			defaultBranch: "main",
		});
		expect(await listPullHeadRefNames(repo)).toEqual([]);
		expect(await listPullHeadRefNames(withoutRecursiveLister(repo))).toEqual(
			[],
		);
	});
});

describe("pull head refs and the wire protocol", () => {
	it("are not advertised to clones or fetches", async () => {
		const { repo, pr } = await repoWithPull();
		for (const service of ["git-upload-pack", "git-receive-pack"] as const) {
			const result = await handleInfoRefs(repo, {
				service,
				defaultBranch: "main",
			});
			const text = new TextDecoder().decode(result.body);
			expect(text).not.toContain("refs/pull/");
			expect(text).toContain(`${pr} refs/heads/topic`);
		}
	});

	it("cannot be written by a push", async () => {
		const { repo, main } = await repoWithPull();
		const body = new Uint8Array([
			...pktLine(`${ZERO_OID} ${main} refs/pull/99/head\0report-status\n`),
			...new TextEncoder().encode("0000"),
		]);
		const { results } = await applyReceivePack(
			repo,
			parseReceivePackBody(body),
			{ defaultBranch: "main" },
		);
		expect(results).toEqual([
			{
				refName: "refs/pull/99/head",
				ok: false,
				reason: "invalid ref name",
			},
		]);
		expect(await listPullHeadRefNames(repo)).not.toContain("refs/pull/99/head");
	});
});
