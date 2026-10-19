import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) =>
	JSON.parse(readFileSync(path.join(root, name), "utf8"));
const workspaces = ["apps", "packages"].flatMap((group) =>
	readdirSync(path.join(root, group), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const directory = `${group}/${entry.name}`;
			return { directory, ...readJson(`${directory}/package.json`) };
		}),
);
const byName = new Map(
	workspaces.map((workspace) => [workspace.name, workspace]),
);

test("workspaces have unique names and explicitly link internal dependencies", () => {
	assert.equal(byName.size, workspaces.length);
	for (const workspace of workspaces) {
		for (const section of ["dependencies", "devDependencies"]) {
			for (const [name, version] of Object.entries(workspace[section] ?? {})) {
				if (byName.has(name)) {
					assert.ok(
						version.startsWith("workspace:"),
						`${workspace.name}: ${name} must use workspace:`,
					);
				}
			}
		}
	}
});

test("runtime workspaces share TypeScript configuration and validation commands", () => {
	for (const workspace of workspaces.filter(
		(workspace) => workspace.name !== "@pushstack/tsconfig",
	)) {
		for (const command of ["build", "typecheck", "test", "lint"]) {
			assert.ok(
				workspace.scripts?.[command],
				`${workspace.name} needs ${command}`,
			);
		}
		const tsconfig = readJson(`${workspace.directory}/tsconfig.json`);
		assert.match(tsconfig.extends, /^@pushstack\/tsconfig\//, workspace.name);
		assert.equal(
			workspace.devDependencies?.["@pushstack/tsconfig"],
			"workspace:*",
			workspace.name,
		);
	}
});

test("shared direct dependencies use consistent version ranges", () => {
	const versions = new Map();
	for (const workspace of [readJson("package.json"), ...workspaces]) {
		for (const section of ["dependencies", "devDependencies"]) {
			for (const [name, version] of Object.entries(workspace[section] ?? {})) {
				if (version.startsWith("workspace:")) continue;
				if (versions.has(name))
					assert.equal(
						version,
						versions.get(name),
						`${workspace.name}: ${name}`,
					);
				versions.set(name, version);
			}
		}
	}
});

test("dependency policy has no overrides or advisory exclusions", () => {
	for (const workspace of [readJson("package.json"), ...workspaces]) {
		assert.equal(workspace.pnpm?.overrides, undefined, workspace.name);
		assert.equal(workspace.pnpm?.auditConfig, undefined, workspace.name);
		assert.equal(workspace.overrides, undefined, workspace.name);
		assert.equal(workspace.resolutions, undefined, workspace.name);
	}
	const settings = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
	assert.doesNotMatch(
		settings,
		/^\s*(overrides|auditConfig|ignoreGhsas|ignoreCves):/m,
	);
});
