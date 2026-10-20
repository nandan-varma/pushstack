import { getBranches, getCommit } from "../git-read";
import { safeBranchNameSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import { apiUrl, encodePath, json, notFoundError, pagedList } from "./http";
import { readableRepository } from "./repo-lookup";
import { branchHtmlUrl, commitObject, commitRef } from "./serializers";

export async function listBranches(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const branches = await getBranches(ownerKeyOf(repo), repo.name);
	branches.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return pagedList(ctx.url, branches, (branch) => ({
		name: branch.name,
		commit: commitRef({ fullName }, branch.commit),
		protected: false,
	}));
}

/** `GET /repos/{owner}/{repo}/branches/{branch}` (the name may contain slashes). */
export async function getBranch(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const name = ctx.params.branch ?? "";
	if (!safeBranchNameSchema.safeParse(name).success) throw notFoundError();
	const ownerKey = ownerKeyOf(repo);
	const fullName = `${repo.owner.username}/${repo.name}`;
	const branch = (await getBranches(ownerKey, repo.name)).find(
		(candidate) => candidate.name === name,
	);
	if (!branch) throw notFoundError("Branch not found");
	const info = await getCommit(ownerKey, repo.name, branch.commit);

	return json({
		name: branch.name,
		commit: commitObject(fullName, info),
		_links: {
			self: apiUrl(`/repos/${fullName}/branches/${encodePath(branch.name)}`),
			html: branchHtmlUrl(fullName, branch.name),
		},
		protected: false,
	});
}
