/**
 * The R2 key layout: a repository's git data lives at
 * `repos/{ownerKey}/{repoName}/git/…`, where `ownerKey` is the owner's
 * (required, immutable) username. The only place keys are built.
 */

import { STORAGE_NAME_RE } from "#/lib/storage-name";

/**
 * Fails closed on a name that isn't a single safe segment: gitFs resolves
 * `..` in the paths it maps onto keys, so one could address another
 * repository's storage. Names are validated at input; this is the backstop.
 */
function segment(value: string, what: string): string {
	if (!STORAGE_NAME_RE.test(value)) {
		throw new Error(`Invalid ${what} for storage: ${JSON.stringify(value)}`);
	}
	return value;
}

export function ownerKeyOf(repo: { owner: { username: string } }): string {
	return repo.owner.username;
}

export function getRepoGitStorageRoot(
	ownerKey: string,
	repoName: string,
): string {
	return `repos/${segment(ownerKey, "owner")}/${segment(repoName, "repository name")}/git`;
}

export function getRepoGitStoragePrefix(
	ownerKey: string,
	repoName: string,
): string {
	return `${getRepoGitStorageRoot(ownerKey, repoName)}/`;
}

/**
 * Release assets live beside the git data, under
 * `repos/{ownerKey}/{repoName}/releases/`, keyed by the asset's immutable id
 * (its name and label are editable and may hold any character).
 */
export function getRepoReleaseStoragePrefix(
	ownerKey: string,
	repoName: string,
): string {
	return `repos/${segment(ownerKey, "owner")}/${segment(repoName, "repository name")}/releases/`;
}

/**
 * Where a presigned upload lands. `finish` copies the verified object to
 * {@link getReleaseAssetKey} and deletes this one, so a `PUT` replayed to the
 * (still valid) URL after `finish` cannot change a published asset.
 */
export function getReleaseAssetUploadKey(
	ownerKey: string,
	repoName: string,
	assetId: number,
): string {
	return `${getRepoReleaseStoragePrefix(ownerKey, repoName)}uploads/${getReleaseAssetKey(ownerKey, repoName, assetId).split("/").at(-1)}`;
}

export function getReleaseAssetKey(
	ownerKey: string,
	repoName: string,
	assetId: number,
): string {
	if (!Number.isSafeInteger(assetId) || assetId <= 0) {
		throw new Error(`Invalid release asset id for storage: ${assetId}`);
	}
	return `${getRepoReleaseStoragePrefix(ownerKey, repoName)}${assetId}`;
}

export interface RepoGitStorageKey {
	ownerKey: string;
	repoName: string;
	/** Path relative to the gitdir; listing prefixes keep their trailing `/`. */
	gitdirPath: string;
}

/** Inverse of {@link getRepoGitStoragePrefix}; null for keys outside the layout. */
export function parseRepoGitStorageKey(key: string): RepoGitStorageKey | null {
	const [root, ownerKey, repoName, git, ...rest] = key.split("/");
	if (
		root !== "repos" ||
		!ownerKey ||
		!repoName ||
		git !== "git" ||
		rest.length === 0
	) {
		return null;
	}
	return { ownerKey, repoName, gitdirPath: rest.join("/") };
}
