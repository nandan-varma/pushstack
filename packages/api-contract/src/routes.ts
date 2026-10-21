/**
 * Every `/api/v3` operation's route, keyed by GitHub's operation id: method,
 * path template, docs link and success status. Plain data, no zod: clients
 * import it through `@pushstack/api-contract/client`. Order matters
 * where templates overlap: the first match wins, so literal segments first.
 */
import type { InputArgs } from "./endpoints";
import {
	type BuiltRequest,
	buildRequest,
	type Method,
	matchPath,
	type Route,
} from "./route";

const DOCS = "https://docs.github.com/rest";

export const routes = {
	"rate-limit/get": {
		method: "GET",
		path: "/rate_limit",
		docs: `${DOCS}/rate-limit/rate-limit#get-rate-limit-status-for-the-authenticated-user`,
	},

	"users/get-authenticated": {
		method: "GET",
		path: "/user",
		docs: `${DOCS}/users/users#get-the-authenticated-user`,
	},
	"repos/list-for-authenticated-user": {
		method: "GET",
		path: "/user/repos",
		docs: `${DOCS}/repos/repos#list-repositories-for-the-authenticated-user`,
	},
	"repos/create-for-authenticated-user": {
		method: "POST",
		path: "/user/repos",
		docs: `${DOCS}/repos/repos#create-a-repository-for-the-authenticated-user`,
		status: 201,
	},
	"users/get-by-id": {
		method: "GET",
		path: "/user/{account_id}",
		docs: `${DOCS}/users/users#get-a-user-using-their-id`,
	},
	"users/get-by-username": {
		method: "GET",
		path: "/users/{username}",
		docs: `${DOCS}/users/users#get-a-user`,
	},
	"repos/list-for-user": {
		method: "GET",
		path: "/users/{username}/repos",
		docs: `${DOCS}/repos/repos#list-repositories-for-a-user`,
	},

	"repos/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}",
		docs: `${DOCS}/repos/repos#get-a-repository`,
	},
	"repos/list-branches": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches",
		docs: `${DOCS}/branches/branches#list-branches`,
	},
	"repos/get-branch": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}",
		docs: `${DOCS}/branches/branches#get-a-branch`,
	},
	"repos/list-tags": {
		method: "GET",
		path: "/repos/{owner}/{repo}/tags",
		docs: `${DOCS}/repos/repos#list-repository-tags`,
	},

	"repos/get-content": {
		method: "GET",
		path: "/repos/{owner}/{repo}/contents/{+path}",
		docs: `${DOCS}/repos/contents#get-repository-content`,
	},
	"repos/create-or-update-file-contents": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/contents/{+path}",
		docs: `${DOCS}/repos/contents#create-or-update-file-contents`,
	},
	"repos/delete-file": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/contents/{+path}",
		docs: `${DOCS}/repos/contents#delete-a-file`,
		deleteBody: true,
	},
	"repos/list-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits",
		docs: `${DOCS}/commits/commits#list-commits`,
	},
	"repos/get-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{+ref}",
		docs: `${DOCS}/commits/commits#get-a-commit`,
	},
	"repos/compare-commits-with-basehead": {
		method: "GET",
		path: "/repos/{owner}/{repo}/compare/{+basehead}",
		docs: `${DOCS}/commits/commits#compare-two-commits`,
	},

	"git/get-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/ref/{+ref}",
		docs: `${DOCS}/git/refs#get-a-reference`,
	},
	"git/list-refs": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/refs/{+ref}",
		docs: `${DOCS}/git/refs#get-a-reference`,
	},
	"git/list-matching-refs": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/matching-refs/{+ref}",
		docs: `${DOCS}/git/refs#list-matching-references`,
	},
	"git/delete-ref": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/git/refs/{+ref}",
		docs: `${DOCS}/git/refs#delete-a-reference`,
		status: 204,
	},
	"git/get-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/commits/{commit_sha}",
		docs: `${DOCS}/git/commits#get-a-commit-object`,
	},
	"git/get-tree": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/trees/{+tree_sha}",
		docs: `${DOCS}/git/trees#get-a-tree`,
	},
	"git/get-blob": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/blobs/{file_sha}",
		docs: `${DOCS}/git/blobs#get-a-blob`,
	},

	"issues/list-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues",
		docs: `${DOCS}/issues/issues#list-repository-issues`,
	},
	"issues/create": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues",
		docs: `${DOCS}/issues/issues#create-an-issue`,
		status: 201,
	},
	"issues/get-comment": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#get-an-issue-comment`,
	},
	"issues/update-comment": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#update-an-issue-comment`,
	},
	"issues/delete-comment": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#delete-an-issue-comment`,
		status: 204,
	},
	"reactions/list-for-issue-comment": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
		docs: `${DOCS}/reactions/reactions#list-reactions-for-an-issue-comment`,
	},
	"reactions/create-for-issue-comment": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
		docs: `${DOCS}/reactions/reactions#create-reaction-for-an-issue-comment`,
		/** 201 when created, 200 when the caller already had that reaction. */
		status: 201,
	},
	"reactions/delete-for-issue-comment": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}",
		docs: `${DOCS}/reactions/reactions#delete-an-issue-comment-reaction`,
		status: 204,
	},
	"issues/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}",
		docs: `${DOCS}/issues/issues#get-an-issue`,
	},
	"issues/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/issues/{issue_number}",
		docs: `${DOCS}/issues/issues#update-an-issue`,
	},
	"issues/list-comments": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
		docs: `${DOCS}/issues/comments#list-issue-comments`,
	},
	"issues/create-comment": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
		docs: `${DOCS}/issues/comments#create-an-issue-comment`,
		status: 201,
	},
	"issues/list-events-for-timeline": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/timeline",
		docs: `${DOCS}/issues/timeline#list-timeline-events-for-an-issue`,
	},
	"issues/list-events": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/events",
		docs: `${DOCS}/issues/events#list-issue-events`,
	},
	"reactions/list-for-issue": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/reactions",
		docs: `${DOCS}/reactions/reactions#list-reactions-for-an-issue`,
	},
	"reactions/create-for-issue": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/reactions",
		docs: `${DOCS}/reactions/reactions#create-reaction-for-an-issue`,
		/** 201 when created, 200 when the caller already had that reaction. */
		status: 201,
	},
	"reactions/delete-for-issue": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}",
		docs: `${DOCS}/reactions/reactions#delete-an-issue-reaction`,
		status: 204,
	},
	"issues/list-labels-on-issue": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#list-labels-for-an-issue`,
	},
	"issues/add-labels": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#add-labels-to-an-issue`,
	},
	"issues/set-labels": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#set-labels-for-an-issue`,
	},
	"issues/remove-all-labels": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#remove-all-labels-from-an-issue`,
		status: 204,
	},
	"issues/remove-label": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}",
		docs: `${DOCS}/issues/labels#remove-a-label-from-an-issue`,
	},

	"pulls/list": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls",
		docs: `${DOCS}/pulls/pulls#list-pull-requests`,
	},
	"pulls/create": {
		method: "POST",
		path: "/repos/{owner}/{repo}/pulls",
		docs: `${DOCS}/pulls/pulls#create-a-pull-request`,
		status: 201,
	},
	"pulls/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}",
		docs: `${DOCS}/pulls/pulls#get-a-pull-request`,
	},
	"pulls/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}",
		docs: `${DOCS}/pulls/pulls#update-a-pull-request`,
	},
	"pulls/check-if-merged": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/merge",
		docs: `${DOCS}/pulls/pulls#check-if-a-pull-request-has-been-merged`,
		/** 204 when merged, 404 when not. */
		status: 204,
	},
	"pulls/merge": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/merge",
		docs: `${DOCS}/pulls/pulls#merge-a-pull-request`,
	},
	"pulls/list-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/commits",
		docs: `${DOCS}/pulls/pulls#list-commits-on-a-pull-request`,
	},
	"pulls/list-files": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/files",
		docs: `${DOCS}/pulls/pulls#list-pull-requests-files`,
	},

	"issues/list-labels-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/labels",
		docs: `${DOCS}/issues/labels#list-labels-for-a-repository`,
	},
	"issues/create-label": {
		method: "POST",
		path: "/repos/{owner}/{repo}/labels",
		docs: `${DOCS}/issues/labels#create-a-label`,
		status: 201,
	},
	"issues/get-label": {
		method: "GET",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#get-a-label`,
	},
	"issues/update-label": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#update-a-label`,
	},
	"issues/delete-label": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#delete-a-label`,
		status: 204,
	},
} as const satisfies Record<string, Route>;

export type OperationId = keyof typeof routes;

/** The request for operation `id` (typed input; not validated client-side). */
export function requestFor<Id extends OperationId>(
	id: Id,
	...[input]: InputArgs<Id>
): BuiltRequest {
	return buildRequest(routes[id], input as Record<string, unknown> | undefined);
}

const table = Object.entries(routes) as [OperationId, Route][];

/** The operation `method pathname` names (first match wins), with its raw params. */
export function matchRoute(
	method: Method,
	pathname: string,
): { id: OperationId; params: Record<string, string> } | null {
	for (const [id, route] of table) {
		if (route.method !== method) continue;
		const params = matchPath(route.path, pathname);
		if (params) return { id, params };
	}
	return null;
}
