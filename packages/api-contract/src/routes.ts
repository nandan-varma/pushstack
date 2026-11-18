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
	"meta/root": {
		method: "GET",
		path: "/",
		docs: `${DOCS}/meta/meta#github-api-root`,
	},
	"meta/get": {
		method: "GET",
		path: "/meta",
		docs: `${DOCS}/meta/meta#get-github-meta-information`,
	},
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
	"users/list-followers-for-authenticated-user": {
		method: "GET",
		path: "/user/followers",
		docs: `${DOCS}/users/followers#list-followers-of-the-authenticated-user`,
	},
	"users/list-followed-by-authenticated-user": {
		method: "GET",
		path: "/user/following",
		docs: `${DOCS}/users/followers#list-the-people-the-authenticated-user-follows`,
	},
	"users/check-person-is-followed-by-authenticated": {
		method: "GET",
		path: "/user/following/{username}",
		docs: `${DOCS}/users/followers#check-if-a-person-is-followed-by-the-authenticated-user`,
		status: 204,
	},
	"users/follow": {
		method: "PUT",
		path: "/user/following/{username}",
		docs: `${DOCS}/users/followers#follow-a-user`,
		status: 204,
	},
	"users/unfollow": {
		method: "DELETE",
		path: "/user/following/{username}",
		docs: `${DOCS}/users/followers#unfollow-a-user`,
		status: 204,
	},

	"orgs/get": {
		method: "GET",
		path: "/orgs/{org}",
		docs: `${DOCS}/orgs/orgs#get-an-organization`,
	},
	"orgs/list-for-authenticated-user": {
		method: "GET",
		path: "/user/orgs",
		docs: `${DOCS}/orgs/orgs#list-organizations-for-the-authenticated-user`,
	},
	"orgs/list-for-user": {
		method: "GET",
		path: "/users/{username}/orgs",
		docs: `${DOCS}/orgs/orgs#list-organizations-for-a-user`,
	},
	"orgs/list-memberships-for-authenticated-user": {
		method: "GET",
		path: "/user/memberships/orgs",
		docs: `${DOCS}/orgs/members#list-organization-memberships-for-the-authenticated-user`,
	},
	"orgs/get-membership-for-authenticated-user": {
		method: "GET",
		path: "/user/memberships/orgs/{org}",
		docs: `${DOCS}/orgs/members#get-an-organization-membership-for-the-authenticated-user`,
	},
	"orgs/list-members": {
		method: "GET",
		path: "/orgs/{org}/members",
		docs: `${DOCS}/orgs/members#list-organization-members`,
	},
	"orgs/check-membership-for-user": {
		method: "GET",
		path: "/orgs/{org}/members/{username}",
		docs: `${DOCS}/orgs/members#check-organization-membership-for-a-user`,
		status: 204,
	},
	"orgs/remove-member": {
		method: "DELETE",
		path: "/orgs/{org}/members/{username}",
		docs: `${DOCS}/orgs/members#remove-organization-member`,
		status: 204,
	},
	"orgs/get-membership-for-user": {
		method: "GET",
		path: "/orgs/{org}/memberships/{username}",
		docs: `${DOCS}/orgs/members#get-organization-membership-for-a-user`,
	},
	"orgs/set-membership-for-user": {
		method: "PUT",
		path: "/orgs/{org}/memberships/{username}",
		docs: `${DOCS}/orgs/members#set-organization-membership-for-a-user`,
	},
	"orgs/remove-membership-for-user": {
		method: "DELETE",
		path: "/orgs/{org}/memberships/{username}",
		docs: `${DOCS}/orgs/members#remove-organization-membership-for-a-user`,
		status: 204,
	},
	"orgs/list-outside-collaborators": {
		method: "GET",
		path: "/orgs/{org}/outside_collaborators",
		docs: `${DOCS}/orgs/outside-collaborators#list-outside-collaborators-for-an-organization`,
	},
	"teams/list": {
		method: "GET",
		path: "/orgs/{org}/teams",
		docs: `${DOCS}/teams/teams#list-teams`,
	},
	"teams/create": {
		method: "POST",
		path: "/orgs/{org}/teams",
		docs: `${DOCS}/teams/teams#create-a-team`,
		status: 201,
	},
	"teams/get-by-name": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}",
		docs: `${DOCS}/teams/teams#get-a-team-by-name`,
	},
	"teams/update-in-org": {
		method: "PATCH",
		path: "/orgs/{org}/teams/{team_slug}",
		docs: `${DOCS}/teams/teams#update-a-team`,
	},
	"teams/delete-in-org": {
		method: "DELETE",
		path: "/orgs/{org}/teams/{team_slug}",
		docs: `${DOCS}/teams/teams#delete-a-team`,
		status: 204,
	},
	"teams/list-child-in-org": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}/teams",
		docs: `${DOCS}/teams/teams#list-child-teams`,
	},
	"teams/list-members-in-org": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}/members",
		docs: `${DOCS}/teams/members#list-team-members`,
	},
	"teams/get-membership-for-user-in-org": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}/memberships/{username}",
		docs: `${DOCS}/teams/members#get-team-membership-for-a-user`,
	},
	"teams/add-or-update-membership-for-user-in-org": {
		method: "PUT",
		path: "/orgs/{org}/teams/{team_slug}/memberships/{username}",
		docs: `${DOCS}/teams/members#add-or-update-team-membership-for-a-user`,
	},
	"teams/remove-membership-for-user-in-org": {
		method: "DELETE",
		path: "/orgs/{org}/teams/{team_slug}/memberships/{username}",
		docs: `${DOCS}/teams/members#remove-team-membership-for-a-user`,
		status: 204,
	},
	"teams/list-repos-in-org": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}/repos",
		docs: `${DOCS}/teams/teams#list-team-repositories`,
	},
	"teams/check-permissions-for-repo-in-org": {
		method: "GET",
		path: "/orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}",
		docs: `${DOCS}/teams/teams#check-team-permissions-for-a-repository`,
	},
	"teams/add-or-update-repo-permissions-in-org": {
		method: "PUT",
		path: "/orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}",
		docs: `${DOCS}/teams/teams#add-or-update-team-repository-permissions`,
		status: 204,
	},
	"teams/remove-repo-in-org": {
		method: "DELETE",
		path: "/orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}",
		docs: `${DOCS}/teams/teams#remove-a-repository-from-a-team`,
		status: 204,
	},
	"activity/list-watched-repos-for-authenticated-user": {
		method: "GET",
		path: "/user/subscriptions",
		docs: `${DOCS}/activity/watching#list-repositories-watched-by-the-authenticated-user`,
	},
	"users/list-gpg-keys-for-authenticated-user": {
		method: "GET",
		path: "/user/gpg_keys",
		docs: `${DOCS}/users/gpg-keys#list-gpg-keys-for-the-authenticated-user`,
	},
	"users/create-gpg-key-for-authenticated-user": {
		method: "POST",
		path: "/user/gpg_keys",
		docs: `${DOCS}/users/gpg-keys#create-a-gpg-key-for-the-authenticated-user`,
		status: 201,
	},
	"users/get-gpg-key-for-authenticated-user": {
		method: "GET",
		path: "/user/gpg_keys/{gpg_key_id}",
		docs: `${DOCS}/users/gpg-keys#get-a-gpg-key-for-the-authenticated-user`,
	},
	"users/delete-gpg-key-for-authenticated-user": {
		method: "DELETE",
		path: "/user/gpg_keys/{gpg_key_id}",
		docs: `${DOCS}/users/gpg-keys#delete-a-gpg-key-for-the-authenticated-user`,
		status: 204,
	},
	"users/list-ssh-signing-keys-for-authenticated-user": {
		method: "GET",
		path: "/user/ssh_signing_keys",
		docs: `${DOCS}/users/ssh-signing-keys#list-ssh-signing-keys-for-the-authenticated-user`,
	},
	"users/create-ssh-signing-key-for-authenticated-user": {
		method: "POST",
		path: "/user/ssh_signing_keys",
		docs: `${DOCS}/users/ssh-signing-keys#create-a-ssh-signing-key-for-the-authenticated-user`,
		status: 201,
	},
	"users/get-ssh-signing-key-for-authenticated-user": {
		method: "GET",
		path: "/user/ssh_signing_keys/{ssh_signing_key_id}",
		docs: `${DOCS}/users/ssh-signing-keys#get-a-ssh-signing-key-for-the-authenticated-user`,
	},
	"users/delete-ssh-signing-key-for-authenticated-user": {
		method: "DELETE",
		path: "/user/ssh_signing_keys/{ssh_signing_key_id}",
		docs: `${DOCS}/users/ssh-signing-keys#delete-a-ssh-signing-key-for-the-authenticated-user`,
		status: 204,
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
	"repos/list-for-org": {
		method: "GET",
		path: "/orgs/{org}/repos",
		docs: `${DOCS}/repos/repos#list-organization-repositories`,
	},
	"repos/create-in-org": {
		method: "POST",
		path: "/orgs/{org}/repos",
		docs: `${DOCS}/repos/repos#create-an-organization-repository`,
		status: 201,
	},
	"search/repos": {
		method: "GET",
		path: "/search/repositories",
		docs: `${DOCS}/search/search#search-repositories`,
	},
	"search/issues-and-pull-requests": {
		method: "GET",
		path: "/search/issues",
		docs: `${DOCS}/search/search#search-issues-and-pull-requests`,
	},
	"users/list-followers-for-user": {
		method: "GET",
		path: "/users/{username}/followers",
		docs: `${DOCS}/users/followers#list-followers-of-a-user`,
	},
	"users/list-following-for-user": {
		method: "GET",
		path: "/users/{username}/following",
		docs: `${DOCS}/users/followers#list-the-people-a-user-follows`,
	},
	"users/check-following-for-user": {
		method: "GET",
		path: "/users/{username}/following/{target_user}",
		docs: `${DOCS}/users/followers#check-if-a-user-follows-another-user`,
		status: 204,
	},
	"activity/list-repos-watched-by-user": {
		method: "GET",
		path: "/users/{username}/subscriptions",
		docs: `${DOCS}/activity/watching#list-repositories-watched-by-a-user`,
	},

	"activity/list-notifications-for-authenticated-user": {
		method: "GET",
		path: "/notifications",
		docs: `${DOCS}/activity/notifications#list-notifications-for-the-authenticated-user`,
	},
	"activity/mark-notifications-as-read": {
		method: "PUT",
		path: "/notifications",
		docs: `${DOCS}/activity/notifications#mark-notifications-as-read`,
		status: 205,
	},
	"activity/get-thread-subscription-for-authenticated-user": {
		method: "GET",
		path: "/notifications/threads/{thread_id}/subscription",
		docs: `${DOCS}/activity/notifications#get-a-thread-subscription-for-the-authenticated-user`,
	},
	"activity/set-thread-subscription": {
		method: "PUT",
		path: "/notifications/threads/{thread_id}/subscription",
		docs: `${DOCS}/activity/notifications#set-a-thread-subscription`,
	},
	"activity/delete-thread-subscription": {
		method: "DELETE",
		path: "/notifications/threads/{thread_id}/subscription",
		docs: `${DOCS}/activity/notifications#delete-a-thread-subscription`,
		status: 204,
	},
	"activity/get-thread": {
		method: "GET",
		path: "/notifications/threads/{thread_id}",
		docs: `${DOCS}/activity/notifications#get-a-thread`,
	},
	"activity/mark-thread-as-read": {
		method: "PATCH",
		path: "/notifications/threads/{thread_id}",
		docs: `${DOCS}/activity/notifications#mark-a-thread-as-read`,
		status: 205,
	},
	"activity/mark-thread-as-done": {
		method: "DELETE",
		path: "/notifications/threads/{thread_id}",
		docs: `${DOCS}/activity/notifications#mark-a-thread-as-done`,
		status: 204,
	},

	"repos/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}",
		docs: `${DOCS}/repos/repos#get-a-repository`,
	},
	"repos/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}",
		docs: `${DOCS}/repos/repos#update-a-repository`,
	},
	"repos/delete": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}",
		docs: `${DOCS}/repos/repos#delete-a-repository`,
		status: 204,
	},
	"repos/get-all-topics": {
		method: "GET",
		path: "/repos/{owner}/{repo}/topics",
		docs: `${DOCS}/repos/repos#get-all-repository-topics`,
	},
	"repos/replace-all-topics": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/topics",
		docs: `${DOCS}/repos/repos#replace-all-repository-topics`,
	},
	"repos/transfer": {
		method: "POST",
		path: "/repos/{owner}/{repo}/transfer",
		docs: `${DOCS}/repos/repos#transfer-a-repository`,
		status: 202,
	},
	"repos/create-using-template": {
		method: "POST",
		path: "/repos/{template_owner}/{template_repo}/generate",
		docs: `${DOCS}/repos/repos#create-a-repository-using-a-template`,
		status: 201,
	},
	"repos/list-forks": {
		method: "GET",
		path: "/repos/{owner}/{repo}/forks",
		docs: `${DOCS}/repos/forks#list-forks`,
	},
	"repos/create-fork": {
		method: "POST",
		path: "/repos/{owner}/{repo}/forks",
		docs: `${DOCS}/repos/forks#create-a-fork`,
		status: 202,
	},
	"repos/merge-upstream": {
		method: "POST",
		path: "/repos/{owner}/{repo}/merge-upstream",
		docs: `${DOCS}/repos/branches#sync-a-fork-branch-with-the-upstream-repository`,
		status: 200,
	},

	"gists/list": {
		method: "GET",
		path: "/gists",
		docs: `${DOCS}/gists/gists#list-gists-for-the-authenticated-user`,
	},
	"gists/list-public": {
		method: "GET",
		path: "/gists/public",
		docs: `${DOCS}/gists/gists#list-public-gists`,
	},
	"gists/list-starred": {
		method: "GET",
		path: "/gists/starred",
		docs: `${DOCS}/gists/gists#list-starred-gists`,
	},
	"gists/list-for-user": {
		method: "GET",
		path: "/users/{username}/gists",
		docs: `${DOCS}/gists/gists#list-gists-for-a-user`,
	},
	"gists/create": {
		method: "POST",
		path: "/gists",
		docs: `${DOCS}/gists/gists#create-a-gist`,
		status: 201,
	},
	"gists/get": {
		method: "GET",
		path: "/gists/{gist_id}",
		docs: `${DOCS}/gists/gists#get-a-gist`,
	},
	// Every literal segment after the id comes before `get-revision`, which
	// matches any single segment.
	"gists/check-is-starred": {
		method: "GET",
		path: "/gists/{gist_id}/star",
		docs: `${DOCS}/gists/gists#check-if-a-gist-is-starred`,
		status: 204,
	},
	"gists/star": {
		method: "PUT",
		path: "/gists/{gist_id}/star",
		docs: `${DOCS}/gists/gists#star-a-gist`,
		status: 204,
	},
	"gists/unstar": {
		method: "DELETE",
		path: "/gists/{gist_id}/star",
		docs: `${DOCS}/gists/gists#unstar-a-gist`,
		status: 204,
	},
	"gists/list-forks": {
		method: "GET",
		path: "/gists/{gist_id}/forks",
		docs: `${DOCS}/gists/gists#list-gist-forks`,
	},
	"gists/fork": {
		method: "POST",
		path: "/gists/{gist_id}/forks",
		docs: `${DOCS}/gists/gists#fork-a-gist`,
		status: 201,
	},
	"gists/list-commits": {
		method: "GET",
		path: "/gists/{gist_id}/commits",
		docs: `${DOCS}/gists/gists#list-gist-commits`,
	},
	"gists/list-comments": {
		method: "GET",
		path: "/gists/{gist_id}/comments",
		docs: `${DOCS}/gists/comments#list-gist-comments`,
	},
	"gists/create-comment": {
		method: "POST",
		path: "/gists/{gist_id}/comments",
		docs: `${DOCS}/gists/comments#create-a-gist-comment`,
		status: 201,
	},
	"gists/get-comment": {
		method: "GET",
		path: "/gists/{gist_id}/comments/{comment_id}",
		docs: `${DOCS}/gists/comments#get-a-gist-comment`,
	},
	"gists/update-comment": {
		method: "PATCH",
		path: "/gists/{gist_id}/comments/{comment_id}",
		docs: `${DOCS}/gists/comments#update-a-gist-comment`,
	},
	"gists/delete-comment": {
		method: "DELETE",
		path: "/gists/{gist_id}/comments/{comment_id}",
		docs: `${DOCS}/gists/comments#delete-a-gist-comment`,
		status: 204,
	},
	"gists/get-revision": {
		method: "GET",
		path: "/gists/{gist_id}/{sha}",
		docs: `${DOCS}/gists/gists#get-a-gist-revision`,
	},
	"gists/update": {
		method: "PATCH",
		also: ["POST"],
		path: "/gists/{gist_id}",
		docs: `${DOCS}/gists/gists#update-a-gist`,
	},
	"gists/delete": {
		method: "DELETE",
		path: "/gists/{gist_id}",
		docs: `${DOCS}/gists/gists#delete-a-gist`,
		status: 204,
	},

	"activity/list-watchers-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/subscribers",
		docs: `${DOCS}/activity/watching#list-watchers`,
	},
	"activity/get-repo-subscription": {
		method: "GET",
		path: "/repos/{owner}/{repo}/subscription",
		docs: `${DOCS}/activity/watching#get-a-repository-subscription`,
	},
	"activity/set-repo-subscription": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/subscription",
		docs: `${DOCS}/activity/watching#set-a-repository-subscription`,
	},
	"activity/delete-repo-subscription": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/subscription",
		docs: `${DOCS}/activity/watching#delete-a-repository-subscription`,
		status: 204,
	},
	"activity/list-repo-notifications-for-authenticated-user": {
		method: "GET",
		path: "/repos/{owner}/{repo}/notifications",
		docs: `${DOCS}/activity/notifications#list-repository-notifications-for-the-authenticated-user`,
	},
	"activity/mark-repo-notifications-as-read": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/notifications",
		docs: `${DOCS}/activity/notifications#mark-repository-notifications-as-read`,
		status: 205,
	},
	"repos/list-branches": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches",
		docs: `${DOCS}/branches/branches#list-branches`,
	},
	"repos/get-branch-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
	},
	"repos/update-branch-protection": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection",
		docs: `${DOCS}/branches/branch-protection#update-branch-protection`,
	},
	"repos/delete-branch-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection",
		docs: `${DOCS}/branches/branch-protection#delete-branch-protection`,
		status: 204,
	},
	"repos/get-status-checks-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks",
		docs: `${DOCS}/branches/branch-protection#get-status-checks-protection`,
	},
	"repos/update-status-check-protection": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks",
		docs: `${DOCS}/branches/branch-protection#update-status-check-protection`,
	},
	"repos/remove-status-check-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks",
		docs: `${DOCS}/branches/branch-protection#remove-status-check-protection`,
		status: 204,
	},
	"repos/get-all-status-check-contexts": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks/contexts",
		docs: `${DOCS}/branches/branch-protection#get-all-status-check-contexts`,
	},
	"repos/add-status-check-contexts": {
		method: "POST",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks/contexts",
		docs: `${DOCS}/branches/branch-protection#add-status-check-contexts`,
	},
	"repos/set-status-check-contexts": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks/contexts",
		docs: `${DOCS}/branches/branch-protection#set-status-check-contexts`,
	},
	"repos/remove-status-check-contexts": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_status_checks/contexts",
		docs: `${DOCS}/branches/branch-protection#remove-status-check-contexts`,
		deleteBody: true,
	},
	"repos/get-pull-request-review-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_pull_request_reviews",
		docs: `${DOCS}/branches/branch-protection#get-pull-request-review-protection`,
	},
	"repos/update-pull-request-review-protection": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_pull_request_reviews",
		docs: `${DOCS}/branches/branch-protection#update-pull-request-review-protection`,
	},
	"repos/delete-pull-request-review-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/required_pull_request_reviews",
		docs: `${DOCS}/branches/branch-protection#delete-pull-request-review-protection`,
		status: 204,
	},
	"repos/get-admin-branch-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/enforce_admins",
		docs: `${DOCS}/branches/branch-protection#get-admin-branch-protection`,
	},
	"repos/set-admin-branch-protection": {
		method: "POST",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/enforce_admins",
		docs: `${DOCS}/branches/branch-protection#set-admin-branch-protection`,
	},
	"repos/delete-admin-branch-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/enforce_admins",
		docs: `${DOCS}/branches/branch-protection#delete-admin-branch-protection`,
		status: 204,
	},
	"repos/get-force-push-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_force_pushes",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
	},
	"repos/set-force-push-protection": {
		method: "POST",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_force_pushes",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
	},
	"repos/delete-force-push-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_force_pushes",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
		status: 204,
	},
	"repos/get-deletion-protection": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_deletions",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
	},
	"repos/set-deletion-protection": {
		method: "POST",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_deletions",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
	},
	"repos/delete-deletion-protection": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/branches/{+branch}/protection/allow_deletions",
		docs: `${DOCS}/branches/branch-protection#get-branch-protection`,
		status: 204,
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

	"repos/list-webhooks": {
		method: "GET",
		path: "/repos/{owner}/{repo}/hooks",
		docs: `${DOCS}/repos/webhooks#list-repository-webhooks`,
	},
	"repos/create-webhook": {
		method: "POST",
		path: "/repos/{owner}/{repo}/hooks",
		docs: `${DOCS}/repos/webhooks#create-a-repository-webhook`,
		status: 201,
	},
	"repos/get-webhook": {
		method: "GET",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}",
		docs: `${DOCS}/repos/webhooks#get-a-repository-webhook`,
	},
	"repos/update-webhook": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}",
		docs: `${DOCS}/repos/webhooks#update-a-repository-webhook`,
	},
	"repos/delete-webhook": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}",
		docs: `${DOCS}/repos/webhooks#delete-a-repository-webhook`,
		status: 204,
	},
	"repos/get-webhook-config-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/config",
		docs: `${DOCS}/repos/webhooks#get-a-webhook-configuration-for-a-repository`,
	},
	"repos/update-webhook-config-for-repo": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/config",
		docs: `${DOCS}/repos/webhooks#update-a-webhook-configuration-for-a-repository`,
	},
	"repos/ping-webhook": {
		method: "POST",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/pings",
		docs: `${DOCS}/repos/webhooks#ping-a-repository-webhook`,
		status: 204,
	},
	"repos/list-webhook-deliveries": {
		method: "GET",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/deliveries",
		docs: `${DOCS}/repos/webhooks#list-deliveries-for-a-repository-webhook`,
	},
	"repos/get-webhook-delivery": {
		method: "GET",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}",
		docs: `${DOCS}/repos/webhooks#get-a-delivery-for-a-repository-webhook`,
	},
	"repos/redeliver-webhook-delivery": {
		method: "POST",
		path: "/repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}/attempts",
		docs: `${DOCS}/repos/webhooks#redeliver-a-delivery-for-a-repository-webhook`,
		status: 202,
	},

	"repos/list-releases": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases",
		docs: `${DOCS}/releases/releases#list-releases`,
	},
	"repos/create-release": {
		method: "POST",
		path: "/repos/{owner}/{repo}/releases",
		docs: `${DOCS}/releases/releases#create-a-release`,
		status: 201,
	},
	"repos/generate-release-notes": {
		method: "POST",
		path: "/repos/{owner}/{repo}/releases/generate-notes",
		docs: `${DOCS}/releases/releases#generate-release-notes-content-for-a-release`,
	},
	"repos/get-latest-release": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases/latest",
		docs: `${DOCS}/releases/releases#get-the-latest-release`,
	},
	"repos/get-release-by-tag": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases/tags/{tag}",
		docs: `${DOCS}/releases/releases#get-a-release-by-tag-name`,
	},
	"repos/get-release-asset": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases/assets/{asset_id}",
		docs: `${DOCS}/releases/assets#get-a-release-asset`,
	},
	"repos/update-release-asset": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/releases/assets/{asset_id}",
		docs: `${DOCS}/releases/assets#update-a-release-asset`,
	},
	"repos/delete-release-asset": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/releases/assets/{asset_id}",
		docs: `${DOCS}/releases/assets#delete-a-release-asset`,
		status: 204,
	},
	"repos/finish-release-asset-upload": {
		method: "POST",
		path: "/repos/{owner}/{repo}/releases/assets/{asset_id}/finish",
		docs: `${DOCS}/releases/assets`,
	},
	"repos/get-release": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases/{release_id}",
		docs: `${DOCS}/releases/releases#get-a-release`,
	},
	"repos/update-release": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/releases/{release_id}",
		docs: `${DOCS}/releases/releases#update-a-release`,
	},
	"repos/delete-release": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/releases/{release_id}",
		docs: `${DOCS}/releases/releases#delete-a-release`,
		status: 204,
	},
	"repos/list-release-assets": {
		method: "GET",
		path: "/repos/{owner}/{repo}/releases/{release_id}/assets",
		docs: `${DOCS}/releases/assets#list-release-assets`,
	},
	"repos/upload-release-asset": {
		method: "POST",
		path: "/repos/{owner}/{repo}/releases/{release_id}/assets",
		docs: `${DOCS}/releases/assets#upload-a-release-asset`,
		status: 201,
	},
	"repos/create-release-asset-upload": {
		method: "POST",
		path: "/repos/{owner}/{repo}/releases/{release_id}/assets/uploads",
		docs: `${DOCS}/releases/assets`,
		status: 201,
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
	"repos/download-tarball-archive": {
		method: "GET",
		path: "/repos/{owner}/{repo}/tarball/{+ref}",
		docs: `${DOCS}/repos/contents#download-a-repository-archive-tar`,
		status: 302,
	},
	"repos/download-zipball-archive": {
		method: "GET",
		path: "/repos/{owner}/{repo}/zipball/{+ref}",
		docs: `${DOCS}/repos/contents#download-a-repository-archive-zip`,
		status: 302,
	},
	"repos/list-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits",
		docs: `${DOCS}/commits/commits#list-commits`,
	},
	"repos/list-commit-comments-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/comments",
		docs: `${DOCS}/commits/comments#list-commit-comments-for-a-repository`,
	},
	"repos/get-commit-comment": {
		method: "GET",
		path: "/repos/{owner}/{repo}/comments/{comment_id}",
		docs: `${DOCS}/commits/comments#get-a-commit-comment`,
	},
	"repos/update-commit-comment": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/comments/{comment_id}",
		docs: `${DOCS}/commits/comments#update-a-commit-comment`,
	},
	"repos/delete-commit-comment": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/comments/{comment_id}",
		docs: `${DOCS}/commits/comments#delete-a-commit-comment`,
		status: 204,
	},
	"repos/list-comments-for-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{commit_sha}/comments",
		docs: `${DOCS}/commits/comments#list-commit-comments`,
	},
	"repos/create-commit-comment": {
		method: "POST",
		path: "/repos/{owner}/{repo}/commits/{commit_sha}/comments",
		docs: `${DOCS}/commits/comments#create-a-commit-comment`,
		status: 201,
	},
	"repos/create-commit-status": {
		method: "POST",
		path: "/repos/{owner}/{repo}/statuses/{sha}",
		docs: `${DOCS}/commits/statuses#create-a-commit-status`,
		status: 201,
	},
	"repos/list-commit-statuses-for-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{ref}/statuses",
		docs: `${DOCS}/commits/statuses#list-commit-statuses-for-a-reference`,
	},
	"repos/get-combined-status-for-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{ref}/status",
		docs: `${DOCS}/commits/statuses#get-the-combined-status-for-a-specific-reference`,
	},
	"checks/list-for-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{ref}/check-runs",
		docs: `${DOCS}/checks/runs#list-check-runs-for-a-git-reference`,
	},
	"checks/list-suites-for-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{ref}/check-suites",
		docs: `${DOCS}/checks/suites#list-check-suites-for-a-git-reference`,
	},
	"repos/get-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{+ref}",
		docs: `${DOCS}/commits/commits#get-a-commit`,
	},
	"repos/compare-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/compare/{+basehead}",
		docs: `${DOCS}/commits/commits#compare-two-commits`,
	},
	"checks/create": {
		method: "POST",
		path: "/repos/{owner}/{repo}/check-runs",
		docs: `${DOCS}/checks/runs#create-a-check-run`,
		status: 201,
	},
	"checks/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}/check-runs/{check_run_id}",
		docs: `${DOCS}/checks/runs#get-a-check-run`,
	},
	"checks/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/check-runs/{check_run_id}",
		docs: `${DOCS}/checks/runs#update-a-check-run`,
	},
	"checks/create-suite": {
		method: "POST",
		path: "/repos/{owner}/{repo}/check-suites",
		docs: `${DOCS}/checks/suites#create-a-check-suite`,
		status: 201,
	},
	"checks/get-suite": {
		method: "GET",
		path: "/repos/{owner}/{repo}/check-suites/{check_suite_id}",
		docs: `${DOCS}/checks/suites#get-a-check-suite`,
	},
	"checks/list-for-suite": {
		method: "GET",
		path: "/repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs",
		docs: `${DOCS}/checks/runs#list-check-runs-in-a-check-suite`,
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
	"git/create-ref": {
		method: "POST",
		path: "/repos/{owner}/{repo}/git/refs",
		docs: `${DOCS}/git/refs#create-a-reference`,
		status: 201,
	},
	"git/update-ref": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/git/refs/{+ref}",
		docs: `${DOCS}/git/refs#update-a-reference`,
	},
	"git/create-blob": {
		method: "POST",
		path: "/repos/{owner}/{repo}/git/blobs",
		docs: `${DOCS}/git/blobs#create-a-blob`,
		status: 201,
	},
	"git/create-tree": {
		method: "POST",
		path: "/repos/{owner}/{repo}/git/trees",
		docs: `${DOCS}/git/trees#create-a-tree`,
		status: 201,
	},
	"git/create-commit": {
		method: "POST",
		path: "/repos/{owner}/{repo}/git/commits",
		docs: `${DOCS}/git/commits#create-a-commit`,
		status: 201,
	},
	"git/get-tag": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/tags/{tag_sha}",
		docs: `${DOCS}/git/tags#get-a-tag`,
	},
	"git/create-tag": {
		method: "POST",
		path: "/repos/{owner}/{repo}/git/tags",
		docs: `${DOCS}/git/tags#create-a-tag-object`,
		status: 201,
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
	"pulls/list-requested-reviewers": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
		docs: `${DOCS}/pulls/review-requests#get-all-requested-reviewers-for-a-pull-request`,
	},
	"pulls/request-reviewers": {
		method: "POST",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
		docs: `${DOCS}/pulls/review-requests#request-reviewers-for-a-pull-request`,
		status: 201,
	},
	"pulls/remove-requested-reviewers": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
		docs: `${DOCS}/pulls/review-requests#remove-requested-reviewers-from-a-pull-request`,
	},

	"issues/list-milestones": {
		method: "GET",
		path: "/repos/{owner}/{repo}/milestones",
		docs: `${DOCS}/issues/milestones#list-milestones`,
	},
	"issues/create-milestone": {
		method: "POST",
		path: "/repos/{owner}/{repo}/milestones",
		docs: `${DOCS}/issues/milestones#create-a-milestone`,
		status: 201,
	},
	"issues/get-milestone": {
		method: "GET",
		path: "/repos/{owner}/{repo}/milestones/{milestone_number}",
		docs: `${DOCS}/issues/milestones#get-a-milestone`,
	},
	"issues/update-milestone": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/milestones/{milestone_number}",
		docs: `${DOCS}/issues/milestones#update-a-milestone`,
	},
	"issues/delete-milestone": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/milestones/{milestone_number}",
		docs: `${DOCS}/issues/milestones#delete-a-milestone`,
		status: 204,
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
