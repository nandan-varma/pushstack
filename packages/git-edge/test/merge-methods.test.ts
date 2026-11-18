import { MemoryObjectStore, parseLooseObjectPath } from "git-fs-s3";
import git, { type ReadCommitResult } from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { GitEdgeError, GitMergeConflictError } from "../src/errors.js";
import {
	MAX_BASE_HISTORY_COMMITS,
	MAX_RANGE_COMMITS,
	type Repo,
	rebaseable,
	rebaseMerge,
	squashMerge,
} from "../src/merge.js";
import {
	author,
	commit,
	diverge,
	makeRepo,
	mergedFiles,
	type Spec,
	writeSpec,
} from "./merge-harness.js";

async function history(repo: Repo, ref: string) {
	return git.log({ ...repo, ref });
}

/** Writes a commit with its own message and author on top of `parent`. */
async function replay(
	repo: Repo,
	branch: string,
	spec: Spec,
	parent: string,
	message: string,
	who: typeof author,
): Promise<string> {
	const oid = await git.writeCommit({
		...repo,
		commit: {
			message,
			tree: await writeSpec(repo, spec),
			parent: [parent],
			author: who,
			committer: who,
		},
	});
	await git.writeRef({
		...repo,
		ref: `refs/heads/${branch}`,
		value: oid,
		force: true,
	});
	return oid;
}

/** A linear branch of `count` commits on `branch`, from `parent`. */
async function chain(
	repo: Repo,
	branch: string,
	parent: string,
	count: number,
) {
	let head = parent;
	for (let i = 0; i < count; i++) {
		head = await replay(
			repo,
			branch,
			{ "a.txt": "a\n", [`f${i}.txt`]: `${i}\n` },
			head,
			`c${i}\n`,
			author,
		);
	}
	return head;
}

const squash = (
	repo: Repo,
	message: Parameters<typeof squashMerge>[3]["message"],
) =>
	squashMerge(repo, "refs/heads/feature", "refs/heads/main", {
		message,
		authorName: "M",
		authorEmail: "m@m",
	});

describe("squashMerge", () => {
	it("makes one commit on the target with the merged tree and the target as its only parent", async () => {
		const { repo } = await diverge(
			{ "a.txt": "a\n" },
			{ "a.txt": "a\n", "ours.txt": "o\n" },
			{ "a.txt": "a\n", "theirs.txt": "t\n" },
		);
		const mainBefore = await git.resolveRef({
			...repo,
			ref: "refs/heads/main",
		});
		const featureOid = await git.resolveRef({
			...repo,
			ref: "refs/heads/feature",
		});

		const { commitOid } = await squash(repo, "Squashed");

		const { commit: squashed } = await git.readCommit({
			...repo,
			oid: commitOid,
		});
		expect(squashed.parent).toEqual([mainBefore]);
		expect(squashed.message.trim()).toBe("Squashed");
		expect(squashed.author.name).toBe("M");
		expect(Object.keys(await mergedFiles(repo, commitOid)).sort()).toEqual([
			"a.txt",
			"ours.txt",
			"theirs.txt",
		]);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			commitOid,
		);
		// The source's own history is not kept: none of its commits are reachable.
		const reachable = (await history(repo, "refs/heads/main")).map(
			(e) => e.oid,
		);
		expect(reachable).not.toContain(featureOid);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/feature" })).toBe(
			featureOid,
		);
	});

	it("passes the squashed commit messages (oldest first, merges left out) to a message function", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		const one = await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "1.txt": "1\n" },
			base,
			"first\n\nbody one\n",
			author,
		);
		const two = await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "1.txt": "1\n", "2.txt": "2\n" },
			one,
			"second\n",
			author,
		);
		expect(two).toMatch(/^[0-9a-f]{40}$/);
		const seen: string[][] = [];
		await squash(repo, (messages) => {
			seen.push(messages);
			return `Squash of ${messages.length}`;
		});
		expect(seen).toEqual([["first\n\nbody one\n", "second\n"]]);
		const { commit: squashed } = await git.readCommit({
			...repo,
			oid: await git.resolveRef({ ...repo, ref: "refs/heads/main" }),
		});
		expect(squashed.message.trim()).toBe("Squash of 2");
	});

	it("squashes a source that is ahead of the target instead of fast-forwarding", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		await commit(repo, "feature", { "a.txt": "a\n", "b.txt": "b\n" }, [base]);

		const { commitOid } = await squash(repo, "Squash ahead");

		const { commit: squashed } = await git.readCommit({
			...repo,
			oid: commitOid,
		});
		expect(squashed.parent).toEqual([base]);
		expect(Object.keys(await mergedFiles(repo, commitOid)).sort()).toEqual([
			"a.txt",
			"b.txt",
		]);
	});

	it("is a no-op when the target already contains the source", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "feature", { "a.txt": "a\n" }, []);
		const ahead = await commit(
			repo,
			"main",
			{ "a.txt": "a\n", "b.txt": "b\n" },
			[base],
		);
		const { commitOid } = await squash(repo, "unused");
		expect(commitOid).toBe(ahead);
	});

	it("throws GitMergeConflictError and writes nothing on a conflict", async () => {
		const { repo } = await diverge(
			{ "a.txt": "a\n" },
			{ "a.txt": "ours\n" },
			{ "a.txt": "theirs\n" },
		);
		const mainBefore = await git.resolveRef({
			...repo,
			ref: "refs/heads/main",
		});
		const error = await squash(repo, "x").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GitMergeConflictError);
		expect((error as GitMergeConflictError).conflictingPaths).toEqual([
			"a.txt",
		]);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			mainBefore,
		);
	});

	it("refuses unrelated histories with a typed error", async () => {
		const { repo } = await makeRepo();
		await commit(repo, "main", { "a.txt": "a\n" }, []);
		await commit(repo, "feature", { "b.txt": "b\n" }, []);
		await expect(squash(repo, "x")).rejects.toBeInstanceOf(GitEdgeError);
	});
});

/** Fails a read of any object in `forbidden`, so a walk that reaches one fails. */
class GuardedStore extends MemoryObjectStore {
	forbidden = new Set<string>();

	override async get(key: string): Promise<Uint8Array | null> {
		const parsed = parseLooseObjectPath(key);
		if (parsed && this.forbidden.has(parsed.oid)) {
			throw new Error(`read an object below the merge base: ${parsed.oid}`);
		}
		return super.get(key);
	}
}

/** `count` commits on `branch` from `parent`, every one with `parent`'s tree. */
async function stack(
	repo: Repo,
	branch: string,
	parent: string,
	count: number,
): Promise<string> {
	const { commit } = await git.readCommit({ ...repo, oid: parent });
	let head = parent;
	for (let i = 0; i < count; i++) {
		head = await git.writeCommit({
			...repo,
			commit: {
				message: `c${i}\n`,
				tree: commit.tree,
				parent: [head],
				author,
				committer: author,
			},
		});
	}
	await git.writeRef({
		...repo,
		ref: `refs/heads/${branch}`,
		value: head,
		force: true,
	});
	return head;
}

/** A commit at `timestamp` (the range walk reads committer times). */
async function commitAt(
	repo: Repo,
	branch: string,
	spec: Spec,
	parents: string[],
	timestamp: number,
	message: string,
): Promise<string> {
	const oid = await git.writeCommit({
		...repo,
		commit: {
			message,
			tree: await writeSpec(repo, spec),
			parent: parents,
			author: { ...author, timestamp },
			committer: { ...author, timestamp },
		},
	});
	await git.writeRef({
		...repo,
		ref: `refs/heads/${branch}`,
		value: oid,
		force: true,
	});
	return oid;
}

describe("range bounds", () => {
	it("reads no history behind the merge base", async () => {
		const store = new GuardedStore();
		const { repo } = await makeRepo(store);
		const root = await commit(repo, "main", { "a.txt": "a\n" }, []);
		// The merge base is `base`; everything behind it is what a range walk
		// that read the base's history would pay for.
		const base = await stack(repo, "main", root, 300);
		await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "f.txt": "f\n" },
			base,
			"feature work\n",
			author,
		);
		await replay(
			repo,
			"main",
			{ "a.txt": "a\n", "m.txt": "m\n" },
			base,
			"main work\n",
			author,
		);
		const behind = await git.log({ ...repo, ref: base });
		for (const { oid } of behind.slice(1)) store.forbidden.add(oid);

		await expect(squash(repo, "squashed")).resolves.toMatchObject({
			commitOid: expect.stringMatching(/^[0-9a-f]{40}$/),
		});
	});

	it("leaves out a history below the merge base a side branch brought in", async () => {
		const { repo } = await makeRepo();
		// `root` is below the merge base: only a side branch that forked before
		// the base can reach it, and its commit is not part of the range.
		const root = await commitAt(
			repo,
			"main",
			{ "a.txt": "a\n" },
			[],
			author.timestamp - 1_000,
			"root\n",
		);
		const base = await commitAt(
			repo,
			"main",
			{ "a.txt": "a\n", "b.txt": "b\n" },
			[root],
			author.timestamp,
			"base\n",
		);
		const side = await commitAt(
			repo,
			"side",
			{ "a.txt": "a\n", "s.txt": "s\n" },
			[root],
			author.timestamp - 800,
			"side work\n",
		);
		const own = await commitAt(
			repo,
			"feature",
			{ "a.txt": "a\n", "s.txt": "s\n", "f.txt": "f\n" },
			[side],
			author.timestamp - 700,
			"own work\n",
		);
		await commitAt(
			repo,
			"feature",
			{
				"a.txt": "a\n",
				"b.txt": "b\n",
				"f.txt": "f\n",
				"s.txt": "s\n",
			},
			[own, base],
			author.timestamp + 10,
			"merge main\n",
		);
		await commitAt(
			repo,
			"main",
			{ "a.txt": "a\n", "b.txt": "b\n", "m.txt": "m\n" },
			[base],
			author.timestamp + 20,
			"main work\n",
		);

		const seen: string[][] = [];
		await squash(repo, (messages) => {
			seen.push(messages.map((message) => message.trim()));
			return "squashed";
		});
		// The side branch's commits are in the range; the history it forked
		// from, below the merge base, is not.
		expect(seen[0]).toEqual(["side work", "own work"]);
	});

	it("refuses a base history longer than MAX_BASE_HISTORY_COMMITS", async () => {
		const { repo } = await makeRepo();
		const root = await commitAt(
			repo,
			"main",
			{ "a.txt": "a\n" },
			[],
			author.timestamp - 1_000,
			"root\n",
		);
		const base = await stack(repo, "main", root, MAX_BASE_HISTORY_COMMITS + 1);
		const side = await commitAt(
			repo,
			"side",
			{ "a.txt": "a\n", "s.txt": "s\n" },
			[root],
			author.timestamp - 800,
			"side work\n",
		);
		const own = await commitAt(
			repo,
			"feature",
			{ "a.txt": "a\n", "s.txt": "s\n", "f.txt": "f\n" },
			[side],
			author.timestamp - 700,
			"own work\n",
		);
		await commitAt(
			repo,
			"feature",
			{
				"a.txt": "a\n",
				"b.txt": "b\n",
				"f.txt": "f\n",
				"s.txt": "s\n",
			},
			[own, base],
			author.timestamp + 10,
			"merge main\n",
		);
		await commitAt(
			repo,
			"main",
			{ "b.txt": "b\n", "m.txt": "m\n" },
			[base],
			author.timestamp + 20,
			"main work\n",
		);

		const mainBefore = await git.resolveRef({
			...repo,
			ref: "refs/heads/main",
		});
		await expect(
			rebaseMerge(repo, "refs/heads/feature", "refs/heads/main"),
		).rejects.toThrow(/the base's history is longer than/);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			mainBefore,
		);
	});
});

describe("rebaseMerge", () => {
	it("replays each commit onto the target keeping author and message, with no merge commit", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		const carol = {
			name: "Carol",
			email: "c@c",
			timestamp: 1_500_000_000,
			timezoneOffset: 0,
		};
		const dan = {
			name: "Dan",
			email: "d@d",
			timestamp: 1_600_000_000,
			timezoneOffset: 0,
		};
		const one = await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "1.txt": "1\n" },
			base,
			"one\n",
			carol,
		);
		await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "1.txt": "1\n", "2.txt": "2\n" },
			one,
			"two\n",
			dan,
		);
		await commit(repo, "main", { "a.txt": "a\n", "m.txt": "m\n" }, [base]);

		const { commitOid } = await rebaseMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
			{
				authorName: "M",
				authorEmail: "m@m",
			},
		);

		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			commitOid,
		);
		const log = await history(repo, "refs/heads/main");
		// The target's own commit sits between the replayed ones and the base.
		const [rebasedTwo, rebasedOne, targetCommit, root] = log as [
			ReadCommitResult,
			ReadCommitResult,
			ReadCommitResult,
			ReadCommitResult,
		];
		expect(log).toHaveLength(4);
		expect(rebasedTwo.oid).toBe(commitOid);
		expect(rebasedTwo.commit.parent).toEqual([rebasedOne.oid]);
		expect(rebasedOne.commit.parent).toEqual([targetCommit.oid]);
		expect(targetCommit.commit.message.trim()).toBe("main");
		expect(root.oid).toBe(base);
		for (const entry of log)
			expect(entry.commit.parent.length).toBeLessThanOrEqual(1);

		expect(rebasedOne.commit.message.trim()).toBe("one");
		expect(rebasedOne.commit.author).toMatchObject({
			name: "Carol",
			timestamp: 1_500_000_000,
		});
		expect(rebasedOne.commit.committer).toMatchObject({
			name: "M",
			email: "m@m",
		});
		expect(rebasedTwo.commit.author).toMatchObject({ name: "Dan" });
		expect(rebasedTwo.commit.committer).toMatchObject({ name: "M" });
		expect(rebasedOne.oid).not.toBe(one);

		expect(Object.keys(await mergedFiles(repo, commitOid)).sort()).toEqual([
			"1.txt",
			"2.txt",
			"a.txt",
			"m.txt",
		]);
	});

	it("fast-forwards a branch already based on the target", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		const ahead = await commit(
			repo,
			"feature",
			{ "a.txt": "a\n", "b.txt": "b\n" },
			[base],
		);

		const { commitOid } = await rebaseMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
		);

		expect(commitOid).toBe(ahead);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			ahead,
		);
	});

	it("is a no-op when the target already contains the source", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "feature", { "a.txt": "a\n" }, []);
		const ahead = await commit(
			repo,
			"main",
			{ "a.txt": "a\n", "b.txt": "b\n" },
			[base],
		);
		const { commitOid } = await rebaseMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
		);
		expect(commitOid).toBe(ahead);
	});

	it("throws GitMergeConflictError and moves nothing when a replayed commit conflicts", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		await replay(
			repo,
			"feature",
			{ "a.txt": "theirs\n" },
			base,
			"conflict\n",
			author,
		);
		await commit(repo, "main", { "a.txt": "ours\n" }, [base]);
		const mainBefore = await git.resolveRef({
			...repo,
			ref: "refs/heads/main",
		});

		const error = await rebaseMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GitMergeConflictError);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			mainBefore,
		);
	});

	it("refuses a branch with a merge commit (its side history is not replayed)", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		const side = await commit(repo, "side", { "s.txt": "s\n" }, [base]);
		const first = await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "f.txt": "f\n" },
			base,
			"first\n",
			author,
		);
		await git
			.writeCommit({
				...repo,
				commit: {
					message: "merge side\n",
					tree: await writeSpec(repo, {
						"a.txt": "a\n",
						"f.txt": "f\n",
						"s.txt": "s\n",
					}),
					parent: [first, side],
					author,
					committer: author,
				},
			})
			.then((oid) =>
				git.writeRef({
					...repo,
					ref: "refs/heads/feature",
					value: oid,
					force: true,
				}),
			);
		await commit(repo, "main", { "a.txt": "a\n", "m.txt": "m\n" }, [base]);

		await expect(
			rebaseMerge(repo, "refs/heads/feature", "refs/heads/main"),
		).rejects.toBeInstanceOf(GitEdgeError);
	});
});

describe("rebaseable", () => {
	const check = (repo: Repo) =>
		rebaseable(repo, "refs/heads/feature", "refs/heads/main");

	it("is true for a branch that replays cleanly, and writes nothing", async () => {
		const { repo, store } = await diverge(
			{ "a.txt": "a\n" },
			{ "a.txt": "a\n", "ours.txt": "o\n" },
			{ "a.txt": "a\n", "theirs.txt": "t\n" },
		);
		const objects = (store as MemoryObjectStore).size;
		const mainBefore = await git.resolveRef({
			...repo,
			ref: "refs/heads/main",
		});

		expect(await check(repo)).toBe(true);

		// A check is a dry run: no object, ref or commit is written.
		expect((store as MemoryObjectStore).size).toBe(objects);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			mainBefore,
		);
	});

	it("is false when a replay conflicts", async () => {
		const { repo } = await diverge(
			{ "a.txt": "a\n" },
			{ "a.txt": "ours\n" },
			{ "a.txt": "theirs\n" },
		);
		expect(await check(repo)).toBe(false);
	});

	it("is false past MAX_RANGE_COMMITS commits", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		await chain(repo, "feature", base, MAX_RANGE_COMMITS + 1);
		await commit(repo, "main", { "a.txt": "a\n", "m.txt": "m\n" }, [base]);
		expect(await check(repo)).toBe(false);
	});

	it("is false for a branch with a merge commit", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		const side = await commit(repo, "side", { "s.txt": "s\n" }, [base]);
		const first = await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "f.txt": "f\n" },
			base,
			"first\n",
			author,
		);
		await git
			.writeCommit({
				...repo,
				commit: {
					message: "merge side\n",
					tree: await writeSpec(repo, {
						"a.txt": "a\n",
						"f.txt": "f\n",
						"s.txt": "s\n",
					}),
					parent: [first, side],
					author,
					committer: author,
				},
			})
			.then((oid) =>
				git.writeRef({
					...repo,
					ref: "refs/heads/feature",
					value: oid,
					force: true,
				}),
			);
		await commit(repo, "main", { "a.txt": "a\n", "m.txt": "m\n" }, [base]);
		expect(await check(repo)).toBe(false);
	});

	it("is true when the branch is already based on the target", async () => {
		const { repo } = await makeRepo();
		const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
		await replay(
			repo,
			"feature",
			{ "a.txt": "a\n", "f.txt": "f\n" },
			base,
			"first\n",
			author,
		);
		expect(await check(repo)).toBe(true);
	});
});
