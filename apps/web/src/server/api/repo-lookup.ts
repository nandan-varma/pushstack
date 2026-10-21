import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { getAccessForRepository, type RepositoryAccess } from "../repo-access";
import {
	findRepositoryByName,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import { type ApiContext, type Caller, requireScope } from "./auth";
import { forbiddenError, notFoundError } from "./http";

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

/**
 * {@link readableRepository} for a write: a `repo:write` token whose user
 * may push (403 otherwise, as GitHub answers a token without access).
 */
export async function writableRepository(ctx: ApiContext): Promise<{
	repo: RepositoryRowWithOwner;
	access: RepositoryAccess;
	caller: Caller;
}> {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canWrite) {
		throw forbiddenError("Resource not accessible by personal access token");
	}
	return { repo, access, caller };
}
