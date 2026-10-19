/** Resolving `/repos/:owner/:repo` to a repository the caller may read. */
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { getAccessForRepository, type RepositoryAccess } from "../repo-access";
import {
	findRepositoryByName,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import type { ApiContext } from "./auth";
import { notFoundError } from "./http";

/**
 * The repository named by the route's `:owner` and `:repo`. A repository that
 * is missing or that the caller can't read is the same 404 (GitHub's rule:
 * private repositories don't reveal they exist).
 */
export async function readableRepository(
	ctx: ApiContext,
): Promise<{ repo: RepositoryRowWithOwner; access: RepositoryAccess }> {
	const { owner, repo: name } = ctx.params;
	if (!owner || !name) throw notFoundError();
	// Fail closed before a lookup: names are also storage-key segments.
	if (!STORAGE_NAME_RE.test(owner) || !STORAGE_NAME_RE.test(name)) {
		throw notFoundError();
	}
	const repo = await findRepositoryByName(owner, name);
	if (!repo) throw notFoundError();
	const access = await getAccessForRepository(repo, ctx.caller?.userId);
	if (!access.canRead) throw notFoundError();
	return { repo, access };
}
