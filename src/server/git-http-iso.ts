/**
 * Thin wrapper around @nandan-varma/git-fs-s3's smart-HTTP module — the
 * pkt-line framing, reachability walk, receive-pack ref-CAS logic, and pack
 * consolidation all live there now (this file used to hand-roll all of it;
 * git-fs-s3's `/http` module was extracted from an earlier version of this
 * exact file, the same way git-fs.ts was extracted from the old
 * git-r2-backend.ts). What stays here is pushstack-specific: auth checks,
 * choosing R2-backed gitFs (reads) vs local hydrated disk (writes), and R2
 * stale-pack cleanup after a repack.
 *
 * upload-pack (clone/fetch): reads directly from R2 via gitFs, no local disk.
 * receive-pack (push): writes incoming pack to /tmp gitdir, then syncs to R2.
 */

import fs from "node:fs";
import {
	applyReceivePack,
	type GitHttpResult,
	type HttpHooks,
	handleInfoRefs,
	handleUploadPack,
	parseReceivePackBody,
	REPACK_PACK_COUNT_THRESHOLD,
	receivePackResponse,
	repackRepository,
} from "@nandan-varma/git-fs-s3/http";
import { bulkDeleteFromR2 } from "#/lib/r2-operations";
import type { GitAuthContext } from "./git-auth";
import { GitAuthorizationError } from "./git-errors";
import {
	detectLooseObjectsHint,
	gitFs,
	invalidateGitStorageKeys,
	invalidateRepoGitStorage,
} from "./git-fs";
import { withReceivePackLock } from "./git-repo-storage";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { logWarn, perfContext, perfStep } from "./perf-log";

const hooks: HttpHooks = {
	step: perfStep,
	onWarn: (message, err) => logWarn("git-http", message, err),
};

// repackRepository only removes pack/idx files *locally* — this is the other
// half, shared by the live push path (handleReceivePackIso) and
// repackRepositoryNow (the standalone maintenance entry point below): it
// deletes the same gitdir-relative paths from R2 and invalidates the caches
// that would otherwise keep serving the now-deleted names.
async function deleteStalePacksFromR2(
	ownerKey: string,
	repoName: string,
	staleRelativePaths: string[],
): Promise<void> {
	if (staleRelativePaths.length === 0) return;
	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	await bulkDeleteFromR2(staleRelativePaths.map((p) => `${prefix}${p}`)).catch(
		(err: unknown) => {
			logWarn(
				"git-http",
				"failed to delete superseded packs from R2 (non-fatal)",
				err,
			);
		},
	);
	// The repo's cached listings were already invalidated once by
	// syncRepositoryToR2 (before these deletes ran) — invalidate again so a
	// concurrent readdir can't have repopulated them with the now-stale names in
	// the gap between that invalidation and this delete.
	invalidateRepoGitStorage(ownerKey, repoName);
	invalidateGitStorageKeys(staleRelativePaths.map((p) => `${prefix}${p}`));
}

/**
 * Consolidates a repository's packs on demand, outside of a live push —
 * for clearing a backlog that accumulated before the repack threshold (or the
 * R2 cleanup step in deleteStalePacksFromR2) existed, on a repo that won't
 * otherwise get a repack until its next push crosses the threshold again.
 * Runs the same repack + R2 cleanup a real push triggers, via its own
 * hydrate/sync cycle rather than piggybacking on an in-flight push's.
 */
export async function repackRepositoryNow(
	ownerKey: string,
	repoName: string,
	defaultBranch = "main",
	ownerDbId?: string,
): Promise<{ removedPacks: number }> {
	let staleRepackedPaths: string[] = [];
	await withReceivePackLock(
		ownerKey,
		repoName,
		defaultBranch,
		async (localGitdir) => {
			staleRepackedPaths = await repackRepository(
				{ fs, gitdir: localGitdir },
				{ threshold: REPACK_PACK_COUNT_THRESHOLD },
				hooks,
			);
			return null;
		},
		ownerDbId,
	);
	await deleteStalePacksFromR2(ownerKey, repoName, staleRepackedPaths);
	return { removedPacks: staleRepackedPaths.length };
}

export async function handleInfoRefsIso(
	ownerKey: string,
	repoName: string,
	service: "git-upload-pack" | "git-receive-pack",
	authContext: GitAuthContext,
	defaultBranch = "main",
): Promise<GitHttpResult> {
	return perfContext(
		`infoRefs ${ownerKey}/${repoName} ${service}`,
		async () => {
			if (service === "git-upload-pack" && !authContext.canRead) {
				throw new GitAuthorizationError(
					"Access denied: insufficient read permissions",
				);
			}
			if (service === "git-receive-pack" && !authContext.canWrite) {
				throw new GitAuthorizationError(
					"Access denied: insufficient write permissions",
				);
			}

			const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
			return handleInfoRefs(
				{ fs: gitFs, gitdir },
				{ service, defaultBranch, agent: "pushstack/1.0" },
				hooks,
			);
		},
	);
}

export async function handleUploadPackIso(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
): Promise<GitHttpResult> {
	return perfContext(`uploadPack ${ownerKey}/${repoName}`, async () => {
		if (!authContext.canRead) {
			throw new GitAuthorizationError(
				"Access denied: insufficient read permissions",
			);
		}

		const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
		const body = new Uint8Array(await request.arrayBuffer());
		return handleUploadPack(
			{ fs: gitFs, gitdir },
			body,
			// Most repos are fully packed — without this, every object the
			// reachability walk touches pays a doomed loose-object GET before
			// falling back to the pack search. Skipped by the single-pack fast
			// path above (a fresh clone of an already-consolidated repo never
			// reaches this).
			{ beforeWalk: () => detectLooseObjectsHint(ownerKey, repoName) },
			hooks,
		);
	});
}

export async function handleReceivePackIso(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
	defaultBranch = "main",
	ownerDbId?: string,
): Promise<GitHttpResult> {
	return perfContext(`receivePack ${ownerKey}/${repoName}`, async () => {
		if (!authContext.canWrite) {
			throw new GitAuthorizationError(
				"Access denied: insufficient write permissions",
			);
		}

		const body = new Uint8Array(await request.arrayBuffer());
		const parsed = parseReceivePackBody(body);

		// Populated inside the locked closure below by applyReceivePack's
		// internal repack — deleted *locally* there, but only actually
		// removable from R2 once withReceivePackLock's automatic sync has
		// uploaded the new consolidated pack that replaces them (see the
		// deletion after the lock resolves, below).
		let stalePackPaths: string[] = [];

		const results = await withReceivePackLock(
			ownerKey,
			repoName,
			defaultBranch,
			async (localGitdir) => {
				const outcome = await applyReceivePack(
					{ fs, gitdir: localGitdir },
					parsed,
					{
						defaultBranch,
						repack: { threshold: REPACK_PACK_COUNT_THRESHOLD },
					},
					hooks,
				);
				stalePackPaths = outcome.stalePackPaths;
				return outcome.results;
			},
			ownerDbId,
		);

		// The new consolidated pack is a normal new local file, so
		// withReceivePackLock's automatic syncRepositoryToR2Unlocked already
		// uploaded it — but that same sync deliberately never deletes anything
		// under objects/ in R2 (git objects are content-addressed and assumed
		// safe to keep). The repack already proved these specific old packs are
		// redundant (reachability-completeness check), so it's safe — and
		// necessary — to explicitly remove them from R2 here, now that the
		// replacement pack they're redundant with is confirmed uploaded.
		// Skipping this is what let every push leave one more permanent pack
		// file in R2 forever.
		await deleteStalePacksFromR2(ownerKey, repoName, stalePackPaths);

		return receivePackResponse(results);
	});
}
