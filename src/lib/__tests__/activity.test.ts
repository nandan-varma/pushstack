import { describe, expect, it } from "vitest";
import { describeActivity } from "../activity";

const baseActivity = {
	type: "commit",
	metadata: {},
	repository: { name: "my-repo", owner: { username: "alice" } },
	id: 1,
};

describe("describeActivity", () => {
	it("returns text for create_repo activity", () => {
		const result = describeActivity({ ...baseActivity, type: "create_repo" });
		expect(result.text).toBe("Created this repository");
		expect(result.showRepo).toBe(true);
		expect(result.linkTo).toBe("/repo/$owner/$name");
		expect(result.linkParams).toEqual({ owner: "alice", name: "my-repo" });
	});

	it("returns text for star activity", () => {
		const result = describeActivity({ ...baseActivity, type: "star" });
		expect(result.text).toBe("Starred");
		expect(result.showRepo).toBe(true);
	});

	it("returns commit text with message", () => {
		const result = describeActivity({
			...baseActivity,
			type: "commit",
			metadata: { message: "fix: resolve bug" },
		});
		expect(result.text).toBe('Pushed a commit: "fix: resolve bug"');
	});

	it("returns commit text without message", () => {
		const result = describeActivity({
			...baseActivity,
			type: "commit",
			metadata: {},
		});
		expect(result.text).toBe("Pushed a commit");
	});

	it("returns issue open text with title", () => {
		const result = describeActivity({
			...baseActivity,
			type: "issue",
			metadata: { title: "Bug report", issueId: 42 },
		});
		expect(result.text).toBe('Opened issue "Bug report"');
		expect(result.linkTo).toBe("/repo/$owner/$name/issues/$id");
		expect(result.linkParams).toEqual({
			owner: "alice",
			name: "my-repo",
			id: "42",
		});
	});

	it("returns issue closed text", () => {
		const result = describeActivity({
			...baseActivity,
			type: "issue",
			metadata: { action: "closed", title: "Bug" },
		});
		expect(result.text).toBe('Closed issue "Bug"');
	});

	it("returns issue reopened text", () => {
		const result = describeActivity({
			...baseActivity,
			type: "issue",
			metadata: { action: "reopened" },
		});
		expect(result.text).toBe("Reopened issue");
	});

	it("returns issue link without $id when issueId is missing", () => {
		const result = describeActivity({
			...baseActivity,
			type: "issue",
			metadata: {},
		});
		expect(result.linkTo).toBe("/repo/$owner/$name/issues");
		expect(result.linkParams).toEqual({ owner: "alice", name: "my-repo" });
	});

	it("returns merged PR text with title", () => {
		const result = describeActivity({
			...baseActivity,
			type: "pr",
			metadata: { action: "merged", title: "Add feature", prId: 7 },
		});
		expect(result.text).toBe('Merged pull request "Add feature"');
		expect(result.linkTo).toBe("/repo/$owner/$name/pulls/$id");
		expect(result.linkParams).toEqual({
			owner: "alice",
			name: "my-repo",
			id: "7",
		});
	});

	it("returns closed PR text", () => {
		const result = describeActivity({
			...baseActivity,
			type: "pr",
			metadata: { action: "closed" },
		});
		expect(result.text).toBe("Closed pull request");
	});

	it("returns opened PR text", () => {
		const result = describeActivity({
			...baseActivity,
			type: "pr",
			metadata: {},
		});
		expect(result.text).toBe("Opened pull request");
	});

	it("returns PR link without $id when prId is missing", () => {
		const result = describeActivity({
			...baseActivity,
			type: "pr",
			metadata: {},
		});
		expect(result.linkTo).toBe("/repo/$owner/$name/pulls");
	});

	it("returns comment on pull request text when prId present", () => {
		const result = describeActivity({
			...baseActivity,
			type: "comment",
			metadata: { prId: 5 },
		});
		expect(result.text).toBe("Commented on a pull request");
	});

	it("returns comment on issue text when prId absent", () => {
		const result = describeActivity({
			...baseActivity,
			type: "comment",
			metadata: {},
		});
		expect(result.text).toBe("Commented on an issue");
	});

	it("returns the raw type for unknown activity types", () => {
		const result = describeActivity({
			...baseActivity,
			type: "custom_event",
		});
		expect(result.text).toBe("custom_event");
		expect(result.showRepo).toBe(true);
	});

	it("falls back to 'unknown' for missing owner username", () => {
		const result = describeActivity({
			...baseActivity,
			type: "create_repo",
			repository: { name: "repo", owner: null },
		});
		expect(result.linkParams).toEqual({ owner: "unknown", name: "repo" });
	});

	it("falls back to empty repo name when missing", () => {
		const result = describeActivity({
			...baseActivity,
			type: "create_repo",
			repository: { name: "", owner: { username: "bob" } },
		});
		expect(result.linkParams).toEqual({ owner: "bob", name: "" });
	});

	it("handles null repository gracefully", () => {
		const result = describeActivity({
			...baseActivity,
			type: "create_repo",
			repository: null,
		});
		expect(result.linkParams).toEqual({ owner: "unknown", name: "" });
	});

	it("handles missing metadata gracefully", () => {
		const result = describeActivity({
			type: "star",
			metadata: null,
			repository: { name: "r", owner: { username: "u" } },
			id: 1,
		});
		expect(result.text).toBe("Starred");
	});
});
