import assert from "node:assert/strict";
import test from "node:test";
import { missingTags } from "./sync-dogfood.mjs";

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
