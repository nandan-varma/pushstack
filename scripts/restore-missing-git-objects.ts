/**
 * Restore missing loose Git objects into an R2-backed repository from the
 * current checkout, then let the verified repack path consolidate its packs.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/restore-missing-git-objects.ts <owner> <repo> <oid> [...oid]
 *
 * Every source object's Git SHA-1 is independently verified against the OID
 * before it is written. This script only creates missing object keys; it never
 * overwrites refs, packs, or existing object keys.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import { uploadToR2 } from "#/lib/r2-operations";
import { getRepoGitStoragePrefix } from "#/server/git-storage-naming";

const execFile = promisify(execFileCallback);

async function readSourceObject(oid: string): Promise<{ type: string; content: Buffer }> {
	if (!/^[0-9a-f]{40}$/.test(oid)) {
		throw new Error(`Invalid Git object ID: ${oid}`);
	}

	const { stdout: type } = await execFile("git", ["cat-file", "-t", oid], {
		cwd: process.cwd(),
		encoding: "utf8",
	});
	const { stdout: content } = await execFile("git", ["cat-file", type.trim(), oid], {
		cwd: process.cwd(),
		encoding: "buffer",
	});
	return { type: type.trim(), content: Buffer.from(content) };
}

async function main(): Promise<void> {
	const [ownerKey, repoName, ...oids] = process.argv.slice(2);
	if (!ownerKey || !repoName || oids.length === 0) {
		throw new Error(
			"Usage: restore-missing-git-objects.ts <owner> <repo> <oid> [...oid]",
		);
	}

	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	for (const oid of oids) {
		const { type, content } = await readSourceObject(oid);
		const wrapped = Buffer.concat([
			Buffer.from(`${type} ${content.length}\0`),
			content,
		]);
		const actualOid = createHash("sha1").update(wrapped).digest("hex");
		if (actualOid !== oid) {
			throw new Error(`Source object ${oid} failed SHA-1 verification.`);
		}

		const key = `${prefix}objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
		await uploadToR2(key, deflateSync(wrapped));
		console.log(`Restored ${oid} (${type}, ${content.length} bytes).`);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
