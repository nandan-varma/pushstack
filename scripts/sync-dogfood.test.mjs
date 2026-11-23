import assert from "node:assert/strict";
import test from "node:test";
import { missingTags, releaseBody } from "./sync-dogfood.mjs";

test("only adds missing tags and keeps destination-only tags", () => {
	assert.deepEqual(
		missingTags(
			[
				["v1", "a"],
				["v2", "b"],
			],
			[
				["v1", "a"],
				["local", "c"],
			],
		),
		[["v2", "b"]],
	);
});
test("refuses to move a published tag", () => {
	assert.throws(
		() => missingTags([["v1", "a"]], [["v1", "b"]]),
		/Refusing to move published tag v1/,
	);
});

test("GitHub-generated release attributions retain their source profile links", () => {
	assert.equal(
		releaseBody({
			body: "* Improve reviews by @octocat in https://github.com/team/app/pull/1",
		}),
		"* Improve reviews by [@octocat](https://github.com/octocat) in https://github.com/team/app/pull/1",
	);
	assert.equal(
		releaseBody({
			body: "Already linked [@octocat](https://github.com/octocat)",
		}),
		"Already linked [@octocat](https://github.com/octocat)",
	);
});
