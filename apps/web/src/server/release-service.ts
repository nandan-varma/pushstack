/**
 * Release writes that touch git: creating a release creates its tag when the
 * tag is missing (a lightweight tag at `target_commitish`, as GitHub does),
 * and publishing a draft does the same. Callers hold write access; this
 * module neither checks permissions nor knows about HTTP.
 */

import { isNotFoundError, isSafeBranchName } from "git-fs-s3";
import { getGitBaseUrl } from "#/lib/git-utils";
import { MAX_RELEASES_PER_REPOSITORY } from "#/lib/limits";
import { createRef } from "./git-objects";
import { getCommit, getCommitsBetween, getTags } from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import { deleteReleaseAssetObjects } from "./release-assets";
import {
	countReleases,
	createReleaseRow,
	DuplicateReleaseError,
	deleteReleaseRow,
	findReleaseByTag,
	type ReleaseInput,
	type ReleaseRow,
	updateReleaseRow,
} from "./release-store";
import { assertRepositoryCapacity } from "./repository-capacity";

/** The parts of a repository these functions read. */
export interface ReleaseRepo {
	id: number;
	name: string;
	defaultBranch: string;
	owner: { username: string };
}

/** A field GitHub would report as `invalid` or `already_exists` (HTTP 422). */
export class ReleaseInputError extends Error {
	constructor(
		readonly field: string,
		readonly code: "invalid" | "already_exists" | "missing_field",
	) {
		super(`Release ${field} is ${code}`);
	}
}

/** The commit a tag names, or null when there is no such tag. */
async function tagCommit(
	repo: ReleaseRepo,
	tagName: string,
): Promise<string | null> {
	try {
		return (
			await getCommit(ownerKeyOf(repo), repo.name, `refs/tags/${tagName}`)
		).oid;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

/** Create `refs/tags/{tagName}` at `target` unless the tag exists. */
async function ensureTag(
	repo: ReleaseRepo,
	tagName: string,
	target: string,
): Promise<void> {
	if (await tagCommit(repo, tagName)) return;
	let oid: string;
	try {
		oid = (await getCommit(ownerKeyOf(repo), repo.name, target)).oid;
	} catch (error) {
		if (isNotFoundError(error)) {
			throw new ReleaseInputError("target_commitish", "invalid");
		}
		throw error;
	}
	await createRef(ownerKeyOf(repo), repo.name, `refs/tags/${tagName}`, oid);
}

function assertTagName(tagName: string) {
	if (!isSafeBranchName(tagName)) {
		throw new ReleaseInputError("tag_name", "invalid");
	}
}

export async function createRelease(
	repo: ReleaseRepo,
	authorId: string,
	input: ReleaseInput,
): Promise<number> {
	assertTagName(input.tagName);
	assertRepositoryCapacity(
		await countReleases(repo.id, true),
		MAX_RELEASES_PER_REPOSITORY,
		`A repository holds at most ${MAX_RELEASES_PER_REPOSITORY} releases`,
	);
	if (!input.draft) {
		if (await findReleaseByTag(repo.id, input.tagName)) {
			throw new ReleaseInputError("tag_name", "already_exists");
		}
		await ensureTag(repo, input.tagName, input.targetCommitish);
	}
	try {
		return await createReleaseRow(repo.id, authorId, input);
	} catch (error) {
		if (error instanceof DuplicateReleaseError) {
			throw new ReleaseInputError("tag_name", "already_exists");
		}
		throw error;
	}
}

export async function updateRelease(
	repo: ReleaseRepo,
	existing: ReleaseRow,
	fields: Partial<ReleaseInput>,
): Promise<void> {
	const tagName = fields.tagName ?? existing.tagName;
	const draft = fields.draft ?? existing.draft;
	if (fields.tagName !== undefined) assertTagName(tagName);
	if (!draft) {
		const taken = await findReleaseByTag(repo.id, tagName);
		if (taken && taken.id !== existing.id) {
			throw new ReleaseInputError("tag_name", "already_exists");
		}
		await ensureTag(
			repo,
			tagName,
			fields.targetCommitish ?? existing.targetCommitish,
		);
	}
	try {
		await updateReleaseRow(repo.id, existing.id, existing, fields);
	} catch (error) {
		if (error instanceof DuplicateReleaseError) {
			throw new ReleaseInputError("tag_name", "already_exists");
		}
		throw error;
	}
}

/** Delete a release and its stored assets; the tag stays. False when missing. */
export async function deleteRelease(
	repo: ReleaseRepo,
	releaseId: number,
): Promise<boolean> {
	const assetIds = await deleteReleaseRow(repo.id, releaseId);
	if (!assetIds) return false;
	await deleteReleaseAssetObjects(repo, assetIds);
	return true;
}

const NOTES_COMMIT_LIMIT = 250;

/** GitHub's "generate release notes", reduced to the commits since the previous tag. */
export async function generateReleaseNotes(
	repo: ReleaseRepo,
	input: {
		tagName: string;
		targetCommitish?: string;
		previousTagName?: string;
	},
): Promise<{ name: string; body: string }> {
	assertTagName(input.tagName);
	const ownerKey = ownerKeyOf(repo);
	const head =
		(await tagCommit(repo, input.tagName)) ??
		input.targetCommitish ??
		repo.defaultBranch;
	let previous = input.previousTagName ?? null;
	if (previous === null) {
		const names = (await getTags(ownerKey, repo.name)).map((tag) => tag.name);
		const index = names.indexOf(input.tagName);
		previous =
			index > 0
				? (names[index - 1] ?? null)
				: index === -1
					? (names.at(-1) ?? null)
					: null;
	} else if (!(await tagCommit(repo, previous))) {
		throw new ReleaseInputError("previous_tag_name", "invalid");
	}
	let lines: string[] = [];
	try {
		const { commits } = await getCommitsBetween(
			ownerKey,
			repo.name,
			previous ? `refs/tags/${previous}` : head,
			head,
			NOTES_COMMIT_LIMIT,
		);
		lines = previous
			? commits.map(
					(commit) =>
						`* ${commit.message.split("\n")[0]} (${commit.sha.slice(0, 7)})`,
				)
			: [];
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
		throw new ReleaseInputError("target_commitish", "invalid");
	}
	const sections = [
		"## What's Changed",
		...(lines.length ? lines : ["* Initial release"]),
	];
	if (previous) {
		sections.push(
			"",
			`**Full Changelog**: ${getGitBaseUrl()}/${repo.owner.username}/${repo.name}/compare/${previous}...${input.tagName}`,
		);
	}
	return { name: input.tagName, body: sections.join("\n") };
}
