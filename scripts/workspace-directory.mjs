#!/usr/bin/env node
// Prints the repository-relative directory of the workspace that owns a package
// name, for the release workflow: `<pkg>@vX.Y.Z` tags name the package, not its
// directory, and `apps/cli` is not a `packages/*` directory.
//
//   node scripts/workspace-directory.mjs git-fs-s3   -> packages/git-fs-s3
//   node scripts/workspace-directory.mjs pstk -> apps/cli
//
// Exits 1 with a message on stderr when no workspace has that name, which is
// what a typo in a tag should do: fail the release before anything is packed.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageName = process.argv[2];

if (!packageName) {
	console.error("usage: workspace-directory.mjs <package-name>");
	process.exit(2);
}

const manifestName = (directory) => {
	try {
		return JSON.parse(
			readFileSync(path.join(root, directory, "package.json"), "utf8"),
		).name;
	} catch {
		return undefined;
	}
};

for (const group of ["apps", "packages"]) {
	for (const entry of readdirSync(path.join(root, group), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const directory = `${group}/${entry.name}`;
		if (manifestName(directory) === packageName) {
			console.log(directory);
			process.exit(0);
		}
	}
}

console.error(`no workspace declares the package name "${packageName}"`);
process.exit(1);
