import git from "isomorphic-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pktLine } from "../../src/http/pkt-line.js";
import {
	applyReceivePack,
	parseReceivePackBody,
} from "../../src/http/receive-pack.js";
import * as repackModule from "../../src/http/repack.js";
import {
	createGitFs,
	MemoryObjectStore,
	type ObjectStore,
} from "../../src/index.js";
import { authorNow, type Repo } from "../../src/ops/index.js";

const author = authorNow("Test", "test@example.com");
const ZERO_OID = "0".repeat(40);
afterEach(() => vi.restoreAllMocks());

/** Counts every storage call, by operation and key/prefix. */
function countingStore(): { store: ObjectStore; calls: string[] } {
	const inner = new MemoryObjectStore();
	const calls: string[] = [];
	const store: ObjectStore = {
		async get(key) {
			calls.push(`GET ${key}`);
			return inner.get(key);
		},
		async put(key, data) {
			calls.push(`PUT ${key}`);
			return inner.put(key, data);
		},
		async delete(key) {
			calls.push(`DELETE ${key}`);
			return inner.delete(key);
		},
		async head(key) {
			calls.push(`HEAD ${key}`);
			return inner.head(key);
		},
		async list(prefix, options) {
			calls.push(`LIST ${prefix}`);
			return inner.list(prefix, options);
		},
	};
	return { store, calls };
}

async function buildPack(
	staging: Repo,
	parent: string | undefined,
	message: string,
) {
	const blob = await git.writeBlob({
		...staging,
		blob: new TextEncoder().encode(`${message}\n`),
	});
	const tree = await git.writeTree({
		...staging,
		tree: [{ path: "f.txt", mode: "100644", type: "blob", oid: blob }],
	});
	const commit = await git.writeCommit({
		...staging,
		commit: {
			message: `${message}\n`,
			tree,
			parent: parent ? [parent] : [],
			author,
			committer: author,
		},
	});
	const { packfile } = await git.packObjects({
		...staging,
		oids: [blob, tree, commit],
	});
	return { packfile: packfile ?? new Uint8Array(), commit };
}

function body(line: string, pack: Uint8Array): Uint8Array {
	const head = pktLine(line);
	const out = new Uint8Array(head.length + 4 + pack.length);
	out.set(head, 0);
	out.set(new TextEncoder().encode("0000"), head.length);
	out.set(pack, head.length + 4);
	return out;
}

describe("applyReceivePack storage calls", () => {
	it("makes few storage calls for a small push to an existing repo", async () => {
		const { store, calls } = countingStore();
		const fs = createGitFs(store);
		fs.registerGitdir("git", { absentFiles: ["packed-refs", "shallow"] });
		const repo: Repo = { fs, gitdir: "git", cache: {} };
		const staging: Repo = {
			fs: createGitFs(new MemoryObjectStore()),
			gitdir: "git",
			cache: {},
		};
		await git.init({
			...staging,
			dir: staging.gitdir,
			bare: true,
			defaultBranch: "main",
		});
		const first = await buildPack(staging, undefined, "first");
		await applyReceivePack(
			repo,
			parseReceivePackBody(
				body(`${ZERO_OID} ${first.commit} refs/heads/main\n`, first.packfile),
			),
			{ defaultBranch: "main" },
		);
		const second = await buildPack(staging, first.commit, "second");
		calls.length = 0;
		const { results } = await applyReceivePack(
			repo,
			parseReceivePackBody(
				body(
					`${first.commit} ${second.commit} refs/heads/main\n`,
					second.packfile,
				),
			),
			{ defaultBranch: "main" },
		);
		expect(results[0]?.ok).toBe(true);
		// Refs are listed once (one recursive LIST), never per namespace, and the
		// repack reuses the pack listing taken before indexing. Before: 32 calls.
		expect(calls.filter((call) => call.startsWith("LIST git/refs"))).toEqual([
			"LIST git/refs/",
		]);
		expect(calls.filter((call) => call.startsWith("HEAD git/refs"))).toEqual(
			[],
		);
		expect(calls.filter((call) => call.startsWith("PUT git/refs"))).toEqual([
			"PUT git/refs/heads/main",
		]);
		// Pinned. Includes the whole-pack tree-name scan (#236), which lists and
		// reads the incoming pack once more (6 calls) for security.
		expect(
			calls.filter((call) => call === "LIST git/objects/pack/").length,
		).toBe(7);
		expect(calls.length).toBeLessThanOrEqual(29);
	});
});

describe("applyReceivePack ref snapshot and pack listing", () => {
	async function setup() {
		const { store, calls } = countingStore();
		const repo: Repo = { fs: createGitFs(store), gitdir: "git", cache: {} };
		const staging: Repo = {
			fs: createGitFs(new MemoryObjectStore()),
			gitdir: "git",
			cache: {},
		};
		await git.init({
			...staging,
			dir: staging.gitdir,
			bare: true,
			defaultBranch: "main",
		});
		return { repo, staging, calls };
	}

	const promisesOf = (repo: Repo) =>
		(
			repo.fs as unknown as {
				promises: {
					writeFile(path: string, data: string): Promise<void>;
					readdir(path: string): Promise<string[]>;
				};
			}
		).promises;

	it("refuses a creation colliding with a ref that exists only in packed-refs", async () => {
		const { repo, staging } = await setup();
		const first = await buildPack(staging, undefined, "first");
		await applyReceivePack(
			repo,
			parseReceivePackBody(
				body(`${ZERO_OID} ${first.commit} refs/heads/main\n`, first.packfile),
			),
			{ defaultBranch: "main" },
		);
		await promisesOf(repo).writeFile(
			"git/packed-refs",
			`# pack-refs with: peeled fully-peeled sorted \n${first.commit} refs/heads/feature\n`,
		);
		expect(await git.listBranches(repo)).toContain("feature");

		const second = await buildPack(staging, first.commit, "second");
		const { results } = await applyReceivePack(
			repo,
			parseReceivePackBody(
				body(
					`${ZERO_OID} ${second.commit} refs/heads/feature/x\n`,
					second.packfile,
				),
			),
			{ defaultBranch: "main" },
		);
		expect(results[0]).toMatchObject({
			refName: "refs/heads/feature/x",
			ok: false,
			reason:
				"cannot lock ref 'refs/heads/feature/x': 'refs/heads/feature' exists",
		});
	});

	it("consolidates every pack when a push crosses the repack threshold, from the reused listing", async () => {
		const { repo, staging } = await setup();
		const repack = vi.spyOn(repackModule, "repackRepository");
		let parent: string | undefined;
		let stale: string[] = [];
		let pushes = 0;
		// One pack per push until the threshold repack runs.
		while (stale.length === 0 && pushes < 10) {
			const next = await buildPack(staging, parent, `commit ${pushes}`);
			const result = await applyReceivePack(
				repo,
				parseReceivePackBody(
					body(
						`${parent ?? ZERO_OID} ${next.commit} refs/heads/main\n`,
						next.packfile,
					),
				),
				{ defaultBranch: "main" },
			);
			expect(result.results[0]?.ok).toBe(true);
			stale = result.stalePackPaths;
			parent = next.commit;
			pushes += 1;
		}
		// Every pack, the one this push stored included, was consolidated.
		expect(stale.filter((path) => path.endsWith(".pack"))).toHaveLength(pushes);
		const remaining = (
			await promisesOf(repo).readdir("git/objects/pack")
		).filter((name) => name.endsWith(".pack"));
		expect(remaining).toHaveLength(1);
		expect(await git.log({ ...repo, ref: "main" })).toHaveLength(pushes);
		// The repack was handed the push's listing (every earlier pack plus the
		// one just stored), and that is exactly the set it consolidated.
		const handed = repack.mock.calls.at(-1)?.[1]?.packDirectory ?? [];
		const base = (name: string) => name.split("/").pop();
		expect(handed.filter((name) => name.endsWith(".pack")).sort()).toEqual(
			stale
				.filter((path) => path.endsWith(".pack"))
				.map(base)
				.sort(),
		);
	});
});
