import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { createGitFs, MemoryObjectStore } from "../src/index.js";
import {
	authorNow,
	commitFilesToBare,
	listBranches,
	listBranchPage,
	listTagPage,
	listTags,
	type Repo,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");

/** A memory store that counts reads of ref files. */
class CountingStore extends MemoryObjectStore {
	refReads = 0;
	override async get(key: string) {
		if (/\/refs\/(heads|tags)\//.test(key)) this.refReads++;
		return super.get(key);
	}
}

async function repoWithRefs(count: number) {
	const store = new CountingStore();
	const repo: Repo = {
		fs: createGitFs(store),
		gitdir: "repos/alice/blog/git",
		cache: {},
	};
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const oid = await commitFilesToBare(repo, {
		branch: "main",
		message: "first\n",
		author,
		files: [{ path: "a.txt", content: "a\n" }],
	});
	for (let i = 0; i < count; i++) {
		const name = `b${String(i).padStart(3, "0")}`;
		await git.writeRef({ ...repo, ref: `refs/heads/${name}`, value: oid });
		await git.writeRef({
			...repo,
			ref: `refs/tags/t${String(i).padStart(3, "0")}`,
			value: oid,
		});
	}
	return { repo, store };
}

describe("a page of refs", () => {
	it("reads only the page's branch tips, in the list's order", async () => {
		const { repo, store } = await repoWithRefs(40);
		const all = await listBranches(repo);
		const reads = store.refReads;
		store.refReads = 0;
		const page = await listBranchPage(repo, { offset: 10, limit: 5 });
		expect(page.total).toBe(all.length);
		expect(page.branches).toEqual(all.slice(10, 15));
		expect(store.refReads).toBeLessThanOrEqual(5);
		expect(reads).toBeGreaterThan(35);
	});

	it("reads only the page's tags, in the list's order", async () => {
		const { repo, store } = await repoWithRefs(40);
		const all = await listTags(repo);
		store.refReads = 0;
		const page = await listTagPage(repo, { offset: 20, limit: 3 });
		expect(page.total).toBe(all.length);
		expect(page.tags).toEqual(all.slice(20, 23));
		expect(store.refReads).toBeLessThanOrEqual(3);
	});

	it("counts everything but reads nothing for an unreachable page", async () => {
		const { repo, store } = await repoWithRefs(10);
		store.refReads = 0;
		const page = await listBranchPage(repo, { offset: 100, limit: 0 });
		expect(page).toEqual({ total: 11, branches: [] });
		expect(store.refReads).toBe(0);
	});
});
