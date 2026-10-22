import { isNotFoundError } from "git-fs-s3";
import type { DiffResult } from "git-fs-s3/ops";
import { getEntryOid } from "../git-read";
import { apiCaps } from "./caps";
import { apiUrl, encodePath, htmlUrl } from "./http";

/** Shown when a sha is unknown (a deleted branch with no recorded tip). */
export const UNKNOWN_SHA = "0".repeat(40);

/** GitHub's file `status` for a diff entry (there is no rename detection). */
const fileStatus = { added: "added", deleted: "removed", modified: "modified" };

/** The patch GitHub shows: hunks only, without git's `diff --git`/`---`/`+++` header. */
function hunksOf(patch: string): string {
	const start = patch.indexOf("\n@@");
	return start === -1 ? "" : patch.slice(start + 1).replace(/\n$/, "");
}

type DiffFile = DiffResult["files"][number];

/**
 * The given files of `diff` as GitHub diff entries. Patches count against one
 * `apiCaps.patchBudgetBytes` budget per call (Vercel caps buffered responses at
 * 4.5 MB); files past it, binary and oversized ones list without a patch.
 */
export async function diffFileObjects(
	ownerKey: string,
	repoName: string,
	fullName: string,
	diff: Pick<DiffResult, "oldRef" | "newRef"> | null,
	files: DiffFile[],
) {
	let patchBytes = 0;
	const patchFor = (file: DiffFile) => {
		if (file.kind !== "text" || !file.patch) return {};
		const patch = hunksOf(file.patch);
		const size = Buffer.byteLength(patch);
		if (patchBytes + size > apiCaps.patchBudgetBytes) return {};
		patchBytes += size;
		return { patch };
	};
	const patches = files.map(patchFor);
	return Promise.all(
		files.map(async (file, index) => {
			const removed = file.status === "deleted";
			const ref = removed ? diff?.oldRef : diff?.newRef;
			let sha: string | null = null;
			if (ref) {
				try {
					sha = await getEntryOid(ownerKey, repoName, ref, file.path);
				} catch (error) {
					if (!isNotFoundError(error)) throw error;
				}
			}
			const path = encodePath(file.path);
			return {
				sha: sha ?? UNKNOWN_SHA,
				filename: file.path,
				status: fileStatus[file.status],
				additions: file.additions,
				deletions: file.deletions,
				changes: file.additions + file.deletions,
				blob_url: htmlUrl(`/${fullName}/blob/${ref ?? ""}/${path}`),
				raw_url: htmlUrl(`/${fullName}/raw/${ref ?? ""}/${path}`),
				contents_url: apiUrl(
					`/repos/${fullName}/contents/${path}?ref=${ref ?? ""}`,
				),
				...patches[index],
			};
		}),
	);
}
