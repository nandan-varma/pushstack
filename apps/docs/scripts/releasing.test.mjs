import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);

test("release guide names and tag patterns match the publishable workspaces", async () => {
	const [guide, workflow] = await Promise.all([
		readFile(
			new URL("apps/docs/content/docs/internals/releasing.md", root),
			"utf8",
		),
		readFile(new URL(".github/workflows/release-packages.yml", root), "utf8"),
	]);
	const rows = [
		...guide.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|$/gm),
	];
	assert.equal(
		rows.length,
		3,
		"expected all three published packages in the guide",
	);
	for (const [, directory, name, tag] of rows) {
		const manifest = JSON.parse(
			await readFile(new URL(`${directory}/package.json`, root), "utf8"),
		);
		assert.equal(
			manifest.name,
			name,
			`${directory}: stale documented package name`,
		);
		assert.notEqual(
			manifest.private,
			true,
			`${directory}: private workspace cannot be published`,
		);
		assert.equal(tag, `${name}@v*`, `${directory}: incorrect tag convention`);
		assert.ok(
			workflow.includes(`- "${tag}"`),
			`${directory}: release workflow does not accept the documented tag`,
		);
	}
});
