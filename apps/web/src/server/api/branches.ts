import { commitCommentCounts } from "../commit-comment-store";
import { getBranches, getBranchPage, getCommit } from "../git-read";
import { safeBranchNameSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import {
	apiUrl,
	encodePath,
	json,
	linkHeader,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams } from "./input";
import { readableRepository } from "./repo-lookup";
import { branchHtmlUrl, commitObject, commitRef } from "./serializers";

export async function listBranches(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const params = pageParams(ctx.url.searchParams);
	// Only the requested page's tips are read, not every branch of the repository.
	const { total, branches } = await getBranchPage(ownerKeyOf(repo), repo.name, {
		offset: params.offset,
		limit: params.reachable ? params.perPage : 0,
	});
	return json(
		branches.map((branch) => ({
			name: branch.name,
			commit: commitRef({ fullName }, branch.commit),
			protected: false,
		})),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `GET /repos/{owner}/{repo}/branches/{branch}` (the name may contain slashes). */
export async function getBranch(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { branch: name } = pathParams(ctx, "repos/get-branch");
	if (!safeBranchNameSchema.safeParse(name).success) throw notFoundError();
	const ownerKey = ownerKeyOf(repo);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const branch = (await getBranches(ownerKey, repo.name)).find(
		(candidate) => candidate.name === name,
	);
	if (!branch) throw notFoundError("Branch not found");
	const [info, counts] = await Promise.all([
		getCommit(ownerKey, repo.name, branch.commit),
		commitCommentCounts(repo.id, [branch.commit]),
	]);

	return json({
		name: branch.name,
		commit: commitObject(fullName, info, counts.get(info.oid)),
		_links: {
			self: apiUrl(`/repos/${fullName}/branches/${encodePath(branch.name)}`),
			html: branchHtmlUrl(fullName, branch.name),
		},
		protected: false,
	});
}
