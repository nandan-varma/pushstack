/**
 * Replace a repository's complete R2 Git prefix with a valid bare repository
 * on local disk. Intended for disposable/test repositories. A local operator
 * tool: reading the source repository is the one place local disk is used.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/reset-repository-r2.ts <owner> <repo> <path-to-bare-repo>
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { deleteRepoStorage, putStorageObject } from "#/server/git-fs";
import { getRepoGitStoragePrefix } from "#/server/git-storage-naming";

async function listFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(dir, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		}),
	);
	return nested.flat();
}

async function main(): Promise<void> {
	const [ownerKey, repoName, sourcePath] = process.argv.slice(2);
	if (!ownerKey || !repoName || !sourcePath) {
		throw new Error(
			"Usage: reset-repository-r2.ts <owner> <repo> <path-to-bare-repo>",
		);
	}

	const files = (await listFiles(sourcePath)).filter(
		(file) => !file.endsWith(".lock") && relative(sourcePath, file) !== "index",
	);
	if (!files.some((file) => relative(sourcePath, file) === "HEAD")) {
		throw new Error(`${sourcePath} is not a bare repository (no HEAD)`);
	}

	console.log(
		`Replacing R2 Git storage for ${ownerKey}/${repoName} from ${sourcePath} (${files.length} files).`,
	);
	await deleteRepoStorage(ownerKey, repoName);
	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	for (const file of files) {
		await putStorageObject(
			`${prefix}${relative(sourcePath, file)}`,
			new Uint8Array(await readFile(file)),
		);
	}
	console.log("R2 Git storage reset complete.");
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
