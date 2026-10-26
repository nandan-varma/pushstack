import type { ApiContext } from "./auth";
import { apiUrl, json } from "./http";

/**
 * `GET /`: the API root, URL templates for what PushStack serves under
 * GitHub's key names. gh requests it to validate a token and read its
 * `X-OAuth-Scopes`.
 */
export async function getRoot(_ctx: ApiContext) {
	return json({
		current_user_url: apiUrl("/user"),
		current_user_repositories_url: apiUrl(
			"/user/repos{?type,page,per_page,sort}",
		),
		notifications_url: apiUrl("/notifications"),
		rate_limit_url: apiUrl("/rate_limit"),
		repository_url: apiUrl("/repos/{owner}/{repo}"),
		user_url: apiUrl("/users/{user}"),
		user_repositories_url: apiUrl(
			"/users/{user}/repos{?type,page,per_page,sort}",
		),
	});
}

/**
 * `GET /meta`: gh asks a host for its metadata before `gh search` and, for a
 * host that is not github.com, reads `installed_version` as a semver. PushStack
 * is not a GitHub Enterprise release, so the version is a placeholder (0.0.0)
 * that only tells gh to use the REST search syntax it serves.
 */
export async function getMeta(_ctx: ApiContext) {
	return json({ installed_version: "0.0.0" });
}
