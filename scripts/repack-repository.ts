/**
 * Consolidate a repository's Git packs stored in R2.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/repack-repository.ts <owner> <repo>
 *
 * The underlying repack validates every reachable object before publishing the
 * replacement pack. Old R2 packs are removed only after the new pack is synced
 * while the repository write lock is held.
 */
import { parsePackFileName } from "git-fs-s3";
import { listAllR2Files } from "#/lib/r2-operations";
import { repackRepositoryNow } from "#/server/git-http-iso";
import { getRepoGitStoragePrefix } from "#/server/git-storage-naming";

function packCount(
	files: Awaited<ReturnType<typeof listAllR2Files>>,
	prefix: string,
): number {
	return files.filter(
		(file) =>
			parsePackFileName(file.key.slice(`${prefix}objects/pack/`.length))
				?.kind === "pack",
	).length;
}

async function main(): Promise<void> {
	const [ownerKey, repoName] = process.argv.slice(2);
	if (!ownerKey || !repoName) {
		throw new Error("Usage: repack-repository.ts <owner> <repo>");
	}

	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	const before = await listAllR2Files(prefix);
	const beforePacks = packCount(before, prefix);
	console.log(`Found ${beforePacks} pack(s) in ${ownerKey}/${repoName}.`);

	const { removedFiles } = await repackRepositoryNow(ownerKey, repoName);

	const after = await listAllR2Files(prefix);
	const afterPacks = packCount(after, prefix);
	console.log(
		`Repack removed ${removedFiles} file(s); ${afterPacks} pack(s) remain.`,
	);

	if (beforePacks >= 4 && afterPacks !== 1) {
		throw new Error(`Expected one consolidated pack, found ${afterPacks}.`);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
