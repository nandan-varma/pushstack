import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) =>
	JSON.parse(readFileSync(path.join(root, name), "utf8"));
const readText = (name) => readFileSync(path.join(root, name), "utf8");
const packageDirectory = (name) =>
	execFileSync(process.execPath, ["scripts/workspace-directory.mjs", name], {
		cwd: root,
		encoding: "utf8",
	}).trim();
const exists = (name) => existsSync(path.join(root, name));
const github = ".github";
const SETUP_ACTION = `${github}/actions/setup/action.yml`;
const actionFiles = () => {
	const actions = path.join(root, github, "actions");
	if (!existsSync(actions)) return [];
	const files = [];
	for (const entry of readdirSync(actions, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		for (const name of ["action.yml", "action.yaml"]) {
			const file = `${github}/actions/${entry.name}/${name}`;
			if (exists(file)) files.push(file);
		}
	}
	return files;
};
const workflowFiles = () =>
	readdirSync(path.join(root, github, "workflows"))
		.filter((file) => /\.ya?ml$/.test(file))
		.map((file) => `${github}/workflows/${file}`);
const stepFiles = () => [...workflowFiles(), ...actionFiles()];
const usesLines = function* (file) {
	for (const [index, line] of readText(file).split("\n").entries()) {
		const match = line.match(/^\s*-?\s*uses:\s*(\S+)\s*(#\s*(.+))?$/);
		if (match) yield { line: index + 1, ref: match[1], comment: match[3] };
	}
};
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

test("every external action is pinned to a commit SHA with a version comment", () => {
	for (const file of stepFiles()) {
		for (const step of usesLines(file)) {
			const at = `${file}:${step.line}`;
			if (step.ref.startsWith("./")) {
				assert.ok(
					existsSync(path.join(root, step.ref)),
					`${at}: ${step.ref} does not exist`,
				);
				continue;
			}
			assert.match(
				step.ref,
				/@[0-9a-f]{40}$/,
				`${at}: ${step.ref} must be pinned to a commit SHA, not a tag`,
			);
			assert.match(
				step.comment ?? "",
				/^v\d+\.\d+\.\d+/,
				`${at}: ${step.ref} needs a trailing "# vX.Y.Z" comment`,
			);
		}
	}
});

test("dependency installation goes through the shared setup action", () => {
	for (const file of stepFiles()) {
		if (file === SETUP_ACTION) continue;
		assert.doesNotMatch(
			readText(file),
			/pnpm install/,
			`${file}: install through ./.github/actions/setup instead`,
		);
	}
	assert.match(readText(SETUP_ACTION), /pnpm install --frozen-lockfile/);
});

test("Node comes from .node-version, which agrees with engines", () => {
	const pinned = readText(".node-version").trim();
	assert.match(pinned, /^\d+(\.\d+){0,2}$/);
	const major = pinned.split(".")[0];
	assert.equal(readJson("package.json").engines?.node, `>=${major}`);
	for (const file of stepFiles()) {
		assert.doesNotMatch(
			readText(file),
			/^\s*node-version:/m,
			`${file}: use node-version-file: .node-version, not a literal version`,
		);
	}
	assert.match(readText(SETUP_ACTION), /node-version-file: \.node-version/);
});

test("every workflow declares its token permissions", () => {
	for (const file of workflowFiles()) {
		assert.match(
			readText(file),
			/^permissions:/m,
			`${file}: declare least-privilege permissions explicitly`,
		);
	}
});

test("Dependabot watches each composite action directory", () => {
	const config = readText(`${github}/dependabot.yml`);
	const directories = [...config.matchAll(/^\s*directory:\s*(\S+)\s*$/gm)].map(
		(match) => match[1],
	);
	for (const file of actionFiles()) {
		const directory = `/${path.posix.dirname(file)}`;
		assert.ok(
			directories.includes(directory),
			`${file}: add a github-actions entry for ${directory} to ${github}/dependabot.yml (a root entry does not scan it)`,
		);
	}
});

test("every workspace resolves to its directory by package name", () => {
	for (const workspace of workspaces) {
		assert.equal(packageDirectory(workspace.name), workspace.directory);
	}
	// A tag naming a workspace that doesn't exist must fail the release, not
	// silently pack nothing.
	assert.throws(() => packageDirectory("not-a-workspace"));
});
