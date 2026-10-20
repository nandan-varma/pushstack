/** `GET /repos/{owner}/{repo}/branches` and `…/branches/{branch}`. */
import { getBranches, getCommit } from "../git-read";
import { safeBranchNameSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import {
	apiUrl,
	encodePath,
	htmlUrl,
	json,
	notFoundError,
	pagedList,
} from "./http";
import { readableRepository } from "./repo-lookup";
import { branchHtmlUrl, commitRef, gitIdentity } from "./serializers";

/** `GET /repos/{owner}/{repo}/branches` */
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
	const { commit, oid } = await getCommit(ownerKey, repo.name, branch.commit);

	const commitUrl = apiUrl(`/repos/${fullName}/commits/${oid}`);
	return json({
		name: branch.name,
		commit: {
			sha: oid,
			url: commitUrl,
			html_url: htmlUrl(`/repo/${fullName}/commit/${oid}`),
			commit: {
				url: commitUrl,
				author: gitIdentity(commit.author),
				committer: gitIdentity(commit.committer),
				message: commit.message,
				tree: {
					sha: commit.tree,
					url: apiUrl(`/repos/${fullName}/git/trees/${commit.tree}`),
				},
				comment_count: 0,
			},
			// Commits aren't linked to accounts by email (yet).
			author: null,
			committer: null,
			parents: commit.parent.map((sha) => ({
				sha,
				url: apiUrl(`/repos/${fullName}/commits/${sha}`),
				html_url: htmlUrl(`/repo/${fullName}/commit/${sha}`),
			})),
		},
		_links: {
			self: apiUrl(`/repos/${fullName}/branches/${encodePath(branch.name)}`),
			html: branchHtmlUrl(fullName, branch.name),
		},
		protected: false,
	});
}
