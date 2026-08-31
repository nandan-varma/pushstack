/**
 * Consolidate a repository's Git packs stored in R2.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/repack-repository.ts <owner> <repo> [branch]
 *
 * The underlying repack validates every reachable object before publishing the
 * replacement pack. Old R2 packs are removed only after the new pack is synced
 * while the repository write lock is held.
 */
import { listAllR2Files } from "#/lib/r2-operations";
import { repackRepositoryNow } from "#/server/git-http-iso";
import { getRepoGitStoragePrefix } from "#/server/git-storage-naming";

function packCount(files: Awaited<ReturnType<typeof listAllR2Files>>): number {
	return files.filter((file) => file.key.endsWith(".pack")).length;
}

async function main(): Promise<void> {
	const [ownerKey, repoName, defaultBranch = "main"] = process.argv.slice(2);
	if (!ownerKey || !repoName) {
		throw new Error("Usage: repack-repository.ts <owner> <repo> [branch]");
	}

	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	const before = await listAllR2Files(prefix);
	const beforePacks = packCount(before);
	console.log(`Found ${beforePacks} pack(s) in ${ownerKey}/${repoName}.`);

	const { removedPacks } = await repackRepositoryNow(
		ownerKey,
		repoName,
		defaultBranch,
	);

	const after = await listAllR2Files(prefix);
	const afterPacks = packCount(after);
	console.log(
		`Repack removed ${removedPacks / 2} pack(s); ${afterPacks} pack(s) remain.`,
	);

	if (beforePacks >= 4 && afterPacks !== 1) {
		throw new Error(`Expected one consolidated pack, found ${afterPacks}.`);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
