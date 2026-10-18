import { describe, expect, it } from "vitest";
import { type ActivityRow, describeActivity } from "../activity";

const repository = { name: "my-repo", owner: { username: "alice" } };
const row = (
	type: ActivityRow["type"],
	metadata: ActivityRow["metadata"],
): ActivityRow => ({
	id: 1,
	type,
	metadata,
	createdAt: new Date(0),
	repository,
});
const repo = { owner: "alice", name: "my-repo" };

describe("describeActivity", () => {
	it("links repository events to the repository", () => {
		expect(
			describeActivity(row("create_repo", { repoName: "my-repo" })),
		).toEqual({
			text: "Created this repository",
			link: { to: "/repo/$owner/$name", params: repo },
		});
		expect(describeActivity(row("star", null)).text).toBe("Starred");
	});

	it("links a commit to its commit page", () => {
		expect(
			describeActivity(row("commit", { commitSha: "abc", message: "fix" })),
		).toEqual({
			text: 'Committed "fix"',
			link: {
				to: "/repo/$owner/$name/commit/$sha",
				params: { ...repo, sha: "abc" },
			},
		});
	});

	it.each([
		["opened", "Opened"],
		["closed", "Closed"],
		["reopened", "Reopened"],
	] as const)("describes an issue %s", (action, verb) => {
		expect(
			describeActivity(row("issue", { number: 4, title: "Bug", action })),
		).toEqual({
			text: `${verb} issue "Bug"`,
			link: {
				to: "/repo/$owner/$name/issues/$id",
				params: { ...repo, id: "4" },
			},
		});
	});

	it("describes a merged pull request", () => {
		expect(
			describeActivity(
				row("pr", { number: 7, title: "Feat", action: "merged" }),
			),
		).toEqual({
			text: 'Merged pull request "Feat"',
			link: {
				to: "/repo/$owner/$name/pulls/$id",
				params: { ...repo, id: "7" },
			},
		});
	});

	it("links a comment to its thread", () => {
		expect(describeActivity(row("comment", { on: "pr", number: 3 }))).toEqual({
			text: "Commented on a pull request",
			link: {
				to: "/repo/$owner/$name/pulls/$id",
				params: { ...repo, id: "3" },
			},
		});
	});

	it("has no link when the repository is gone", () => {
		expect(
			describeActivity({ ...row("star", null), repository: null }).link,
		).toBeNull();
	});
});
