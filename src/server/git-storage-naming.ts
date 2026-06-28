import type { repositories } from "#/db/github-schema";

type OwnerLike = {
	id: string;
	username: string | null;
	email: string;
};

type RepoLike = Pick<typeof repositories.$inferSelect, "ownerId" | "name"> & {
	owner?: OwnerLike | null;
};

function sanitizeStorageSegment(value: string): string {
	return value
		.trim()
		.replace(/[\\/]+/g, "-")
		.replace(/\s+/g, "-");
}

export function getStorageOwnerKey(owner: OwnerLike): string {
	const fallbackUsername = owner.email.split("@")[0] || owner.id;
	return sanitizeStorageSegment(owner.username || fallbackUsername || owner.id);
}

export function getLegacyStorageOwnerKeys(owner: OwnerLike): string[] {
	return [...new Set([sanitizeStorageSegment(owner.id), "NaN"])];
}

export function getRepoStorageCoordinates(repo: RepoLike) {
	if (!repo.owner) {
		throw new Error(`Repository owner metadata missing for ${repo.name}`);
	}

	const ownerKey = getStorageOwnerKey(repo.owner);
	const legacyOwnerKeys = getLegacyStorageOwnerKeys(repo.owner).filter(
		(legacyOwnerKey) => legacyOwnerKey !== ownerKey,
	);

	return {
		ownerKey,
		repoKey: sanitizeStorageSegment(repo.name),
		legacyOwnerKeys,
	};
}

export function getRepoStorageRoot(ownerKey: string, repoName: string): string {
	return `repos/${sanitizeStorageSegment(ownerKey)}/${sanitizeStorageSegment(repoName)}`;
}

export function getRepoGitStorageRoot(
	ownerKey: string,
	repoName: string,
): string {
	return `${getRepoStorageRoot(ownerKey, repoName)}/git`;
}

export function getRepoGitStoragePrefix(
	ownerKey: string,
	repoName: string,
): string {
	return `${getRepoGitStorageRoot(ownerKey, repoName)}/`;
}

export function getLegacyGitPrefixes(
	legacyOwnerKeys: string[],
	repoName: string,
): string[] {
	const gitPrefixes = legacyOwnerKeys.map((legacyOwnerKey) =>
		getRepoGitStoragePrefix(legacyOwnerKey, repoName),
	);
	const legacyFlatPrefixes = legacyOwnerKeys.map(
		(legacyOwnerKey) => `${getRepoStorageRoot(legacyOwnerKey, repoName)}/`,
	);
	const oldTopLevelPrefixes = legacyOwnerKeys.map(
		(legacyOwnerKey) =>
			`git/${sanitizeStorageSegment(legacyOwnerKey)}/${sanitizeStorageSegment(repoName)}/`,
	);

	return [
		...new Set([...gitPrefixes, ...legacyFlatPrefixes, ...oldTopLevelPrefixes]),
	];
}
