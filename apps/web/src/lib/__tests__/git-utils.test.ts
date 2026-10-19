import { describe, expect, it } from "vitest";
import { getCloneUrl, getSetupInstructions } from "../git-utils";

describe("getCloneUrl", () => {
	it("points at this origin's git endpoint", () => {
		expect(getCloneUrl("alice", "my-repo")).toBe(
			"http://localhost:3000/api/git/alice/my-repo.git",
		);
	});
});

describe("getSetupInstructions", () => {
	it("embeds the repository name and clone URL", () => {
		const url = "https://example.com/api/git/alice/my-repo.git";
		const instructions = getSetupInstructions("my-repo", url);
		expect(instructions.newRepo).toContain('echo "# my-repo"');
		for (const block of Object.values(instructions)) {
			expect(block).toContain(url);
		}
	});
});
