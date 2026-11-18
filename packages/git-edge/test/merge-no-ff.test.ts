import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { squashMerge, threeWayMerge } from "../src/merge.js";
import { commit, makeRepo } from "./merge-harness.js";

/** main at one commit, feature a commit ahead of it (a fast-forwardable merge). */
async function ahead() {
	const { repo } = await makeRepo();
	const base = await commit(repo, "main", { "a.txt": "a\n" }, []);
	const feature = await commit(
		repo,
		"feature",
		{ "a.txt": "a\n", "b.txt": "b\n" },
		[base],
	);
	await git.writeRef({
		...repo,
		ref: "refs/heads/main",
		value: base,
		force: true,
	});
	return { repo, base, feature };
}

describe("merge without fast-forward", () => {
	it("fast-forwards by default", async () => {
		const { repo, feature } = await ahead();
		const { commitOid } = await threeWayMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
		);
		expect(commitOid).toBe(feature);
	});

	it("records a merge commit with both parents and the source's tree when asked", async () => {
		const { repo, base, feature } = await ahead();
		const { commitOid } = await threeWayMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
			{
				noFastForward: true,
				authorName: "M",
				authorEmail: "m@m",
				message: "Merge it",
			},
		);
		const { commit: merged } = await git.readCommit({
			...repo,
			oid: commitOid,
		});
		expect(merged.parent).toEqual([base, feature]);
		expect(merged.message.trim()).toBe("Merge it");
		const source = await git.readCommit({ ...repo, oid: feature });
		expect(merged.tree).toBe(source.commit.tree);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			commitOid,
		);
	});

	it("still does nothing when the target already has the source", async () => {
		const { repo, feature } = await ahead();
		await git.writeRef({
			...repo,
			ref: "refs/heads/main",
			value: feature,
			force: true,
		});
		const { commitOid } = await threeWayMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
			{ noFastForward: true },
		);
		expect(commitOid).toBe(feature);
	});

	it("credits a squash to one identity and commits it as another", async () => {
		const { repo } = await ahead();
		const { commitOid } = await squashMerge(
			repo,
			"refs/heads/feature",
			"refs/heads/main",
			{
				message: "Squashed",
				authorName: "Author",
				authorEmail: "author@x",
				committerName: "Merger",
				committerEmail: "merger@x",
			},
		);
		const { commit: squashed } = await git.readCommit({
			...repo,
			oid: commitOid,
		});
		expect(squashed.author).toMatchObject({
			name: "Author",
			email: "author@x",
		});
		expect(squashed.committer).toMatchObject({
			name: "Merger",
			email: "merger@x",
		});
	});
});
