/**
 * GitHub's JSON shapes (snake_case, ISO-8601 timestamps) for what PushStack
 * stores. Fields PushStack has no equivalent for are omitted, never renamed.
 */
import type { Repository } from "#/db/app-schema";
import { getCloneUrl } from "#/lib/git-utils";
import type { PublicUser } from "../repository-lookup";
import { apiUrl, encodePath, htmlUrl, isoTimestamp } from "./http";

export type RepoRole = "owner" | "admin" | "write" | "read" | "anonymous";

export function simpleUser(user: PublicUser) {
	return {
		login: user.username,
		id: user.id,
		avatar_url: user.image,
		url: apiUrl(`/users/${user.username}`),
		html_url: htmlUrl(`/users/${user.username}`),
		type: "User" as const,
		site_admin: false,
	};
}

export function publicUser(
	user: PublicUser & { createdAt: Date; updatedAt: Date },
	counts: { publicRepos: number },
) {
	return {
		...simpleUser(user),
		name: user.name,
		email: null,
		public_repos: counts.publicRepos,
		created_at: isoTimestamp(user.createdAt),
		updated_at: isoTimestamp(user.updatedAt),
	};
}

function permissionsFor(role: RepoRole) {
	return {
		admin: role === "owner" || role === "admin",
		push: role === "owner" || role === "admin" || role === "write",
		pull: true,
	};
}

export function repository(
	repo: Repository & { owner: PublicUser },
	options: { stars: number; role?: RepoRole },
) {
	const fullName = `${repo.owner.username}/${repo.name}`;
	return {
		id: repo.id,
		name: repo.name,
		full_name: fullName,
		private: repo.visibility === "private",
		owner: simpleUser(repo.owner),
		html_url: htmlUrl(`/repo/${repo.owner.username}/${repo.name}`),
		description: repo.description,
		fork: false,
		url: apiUrl(`/repos/${fullName}`),
		clone_url: getCloneUrl(repo.owner.username, repo.name),
		created_at: isoTimestamp(repo.createdAt),
		updated_at: isoTimestamp(repo.updatedAt),
		default_branch: repo.defaultBranch,
		visibility: repo.visibility,
		archived: false,
		disabled: false,
		stargazers_count: options.stars,
		watchers_count: options.stars,
		forks_count: 0,
		...(options.role && { permissions: permissionsFor(options.role) }),
	};
}

/** The `{ sha, url }` pair branches and tags use for their commit. */
export function commitRef(repo: { fullName: string }, sha: string) {
	return { sha, url: apiUrl(`/repos/${repo.fullName}/commits/${sha}`) };
}

export function branchHtmlUrl(fullName: string, branch: string) {
	return htmlUrl(`/repo/${fullName}/tree/${encodePath(branch)}`);
}
