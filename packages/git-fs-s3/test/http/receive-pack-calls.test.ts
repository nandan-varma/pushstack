import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { pktLine } from "../../src/http/pkt-line.js";
import {
	applyReceivePack,
	parseReceivePackBody,
} from "../../src/http/receive-pack.js";
import {
	createGitFs,
	MemoryObjectStore,
	type ObjectStore,
} from "../../src/index.js";
import { authorNow, type Repo } from "../../src/ops/index.js";

const author = authorNow("Test", "test@example.com");
const ZERO_OID = "0".repeat(40);

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
		expect(
			calls.filter((call) => call === "LIST git/objects/pack/").length,
		).toBeLessThanOrEqual(5);
		expect(calls.length).toBeLessThanOrEqual(23);
	});
});
