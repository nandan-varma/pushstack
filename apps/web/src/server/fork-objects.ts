/**
 * Moving commits between repositories of one fork network. The caller holds
 * the destination's lock and moves a ref to the commit before releasing it:
 * the copied pack is not kept, so a repack in between could drop it.
 */
import { GitInvalidRequestError, getObjectTypes, isFullSha } from "git-fs-s3";
import { CopyLimitError, copyMissingObjects, type Repo } from "git-fs-s3/ops";
import { MAX_IMPORT_BYTES, MAX_IMPORT_OBJECTS } from "#/lib/limits";

/**
 * Copy `oid` and what it needs from `src` into `dst`. Refuses (422) a commit
 * `src` doesn't have, and a copy over the per-request caps.
 */
export async function importCommit(
	src: Repo,
	dst: Repo,
	oid: string,
	haves: readonly string[],
	keepUntil?: Date,
): Promise<void> {
	const type = isFullSha(oid)
		? (await getObjectTypes(src, [oid])).get(oid)
		: null;
	if (type !== "commit") {
		throw new GitInvalidRequestError("Object does not exist");
	}
	try {
		await copyMissingObjects(src, dst, oid, {
			haves,
			maxObjects: MAX_IMPORT_OBJECTS,
			maxBytes: MAX_IMPORT_BYTES,
			keepUntil,
		});
	} catch (error) {
		if (error instanceof CopyLimitError) {
			throw new GitInvalidRequestError(error.message);
		}
		throw error;
	}
}
