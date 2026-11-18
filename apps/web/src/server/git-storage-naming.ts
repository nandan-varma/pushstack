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

export function ownerKeyOf(repo: { owner: { login: string } }): string {
	return repo.owner.login;
}

/** A repository's git data, or the wiki's, which is a sibling bare repository. */
export type RepoKind = "repo" | "wiki";

function repoStorageBase(ownerKey: string, repoName: string): string {
	return `repos/${segment(ownerKey, "owner")}/${segment(repoName, "repository name")}`;
}

export function getRepoGitStorageRoot(
	ownerKey: string,
	repoName: string,
	kind: RepoKind = "repo",
): string {
	return kind === "wiki"
		? getRepoWikiGitStorageRoot(ownerKey, repoName)
		: `${repoStorageBase(ownerKey, repoName)}/git`;
}

export function getRepoGitStoragePrefix(
	ownerKey: string,
	repoName: string,
	kind: RepoKind = "repo",
): string {
	return `${getRepoGitStorageRoot(ownerKey, repoName, kind)}/`;
}

export function getRepoWikiGitStorageRoot(
	ownerKey: string,
	repoName: string,
): string {
	return `${repoStorageBase(ownerKey, repoName)}/wiki/git`;
}

/** The wiki's whole directory, so a rename or delete carries it with the repo. */
export function getRepoWikiStoragePrefix(
	ownerKey: string,
	repoName: string,
): string {
	return `${repoStorageBase(ownerKey, repoName)}/wiki/`;
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
	wiki: boolean;
	/** Path relative to the gitdir; listing prefixes keep their trailing `/`. */
	gitdirPath: string;
}

/** Inverse of {@link getRepoGitStoragePrefix}; null for keys outside the layout. */
export function parseRepoGitStorageKey(key: string): RepoGitStorageKey | null {
	const [root, ownerKey, repoName, ...rest] = key.split("/");
	if (root !== "repos" || !ownerKey || !repoName || rest.length === 0) {
		return null;
	}
	const wiki = rest[0] === "wiki";
	const [git, ...gitdir] = wiki ? rest.slice(1) : rest;
	if (git !== "git" || gitdir.length === 0) return null;
	return { ownerKey, repoName, wiki, gitdirPath: gitdir.join("/") };
}

/**
 * A gist is a repository too, with its own top-level prefix: an id is GitHub's
 * 32 lowercase hex, and it names the storage segment, so it is validated with
 * the same backstop as a repository's.
 */
export const GIST_ID_RE = /^[0-9a-f]{32}$/;

function gistSegment(id: string): string {
	if (!GIST_ID_RE.test(id)) {
		throw new Error(`Invalid gist id for storage: ${JSON.stringify(id)}`);
	}
	return id;
}

export function getGistGitStorageRoot(id: string): string {
	return `gists/${gistSegment(id)}/git`;
}

export function getGistGitStoragePrefix(id: string): string {
	return `${getGistGitStorageRoot(id)}/`;
}

export interface GistGitStorageKey {
	gistId: string;
	/** Path relative to the gitdir; listing prefixes keep their trailing `/`. */
	gitdirPath: string;
}

/** Inverse of {@link getGistGitStoragePrefix}; null for keys outside the layout. */
export function parseGistGitStorageKey(key: string): GistGitStorageKey | null {
	const [root, gistId, git, ...rest] = key.split("/");
	if (
		root !== "gists" ||
		!gistId ||
		!GIST_ID_RE.test(gistId) ||
		git !== "git" ||
		rest.length === 0
	) {
		return null;
	}
	return { gistId, gitdirPath: rest.join("/") };
}
