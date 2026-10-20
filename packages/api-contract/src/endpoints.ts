/**
 * Every `/api/v3` endpoint, keyed by GitHub's operation id. Order matters
 * where templates overlap: the first match wins (literal segments first).
 */
import { z } from "zod";
import { defineEndpoints } from "./endpoint";
import {
	assigneeLogins,
	commaList,
	commentBody,
	direction,
	issueParams,
	labelColor,
	labelDescription,
	labelName,
	labelNames,
	pagination,
	positiveInt,
	pullParams,
	repoName,
	repoParams,
	threadBody,
	threadTitle,
} from "./inputs";
import {
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_REPO_DESCRIPTION_CHARS,
} from "./limits";
import {
	blob,
	branch,
	commit,
	commitDetail,
	comparison,
	contents,
	diffEntry,
	gitCommit,
	gitRef,
	gitTree,
	issue,
	issueComment,
	issueEvent,
	label,
	mergeResult,
	privateUser,
	publicUser,
	pullRequest,
	pullRequestSimple,
	rateLimitOverview,
	repository,
	shortBranch,
	stateReason,
	tag,
	timelineItem,
} from "./resources";

const DOCS = "https://docs.github.com/rest";
const noContent = z.null();
const listState = z.enum(["open", "closed", "all"]).default("open");
const commentParams = repoParams.extend({ comment_id: positiveInt });
const labelParams = repoParams.extend({ name: z.string().min(1) });
const repoListSort = z
	.enum(["created", "updated", "pushed", "full_name"])
	.optional()
	.catch(undefined);

export const endpoints = defineEndpoints({
	"rate-limit/get": {
		method: "GET",
		path: "/rate_limit",
		docs: `${DOCS}/rate-limit/rate-limit#get-rate-limit-status-for-the-authenticated-user`,
		response: rateLimitOverview,
	},

	// Users
	"users/get-authenticated": {
		method: "GET",
		path: "/user",
		docs: `${DOCS}/users/users#get-the-authenticated-user`,
		response: privateUser,
	},
	"repos/list-for-authenticated-user": {
		method: "GET",
		path: "/user/repos",
		docs: `${DOCS}/repos/repos#list-repositories-for-the-authenticated-user`,
		query: pagination.extend({
			visibility: z.enum(["all", "public", "private"]).optional(),
			affiliation: commaList(
				z.enum(["owner", "collaborator", "organization_member"]),
				3,
			).optional(),
			type: z.enum(["all", "owner", "public", "private", "member"]).optional(),
			sort: repoListSort,
			direction,
		}),
		response: z.array(repository),
	},
	"repos/create-for-authenticated-user": {
		method: "POST",
		path: "/user/repos",
		docs: `${DOCS}/repos/repos#create-a-repository-for-the-authenticated-user`,
		status: 201,
		body: z.object({
			name: repoName,
			description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).nullish(),
			private: z.boolean().default(false),
			auto_init: z.boolean().default(false),
			/** A template name; the server checks it against its list. */
			gitignore_template: z.string().optional(),
			license_template: z.string().optional(),
		}),
		response: repository,
	},
	"users/get-by-id": {
		method: "GET",
		path: "/user/{account_id}",
		docs: `${DOCS}/users/users#get-a-user-using-their-id`,
		params: z.object({ account_id: positiveInt.max(2_147_483_647) }),
		response: publicUser,
	},
	"users/get-by-username": {
		method: "GET",
		path: "/users/{username}",
		docs: `${DOCS}/users/users#get-a-user`,
		params: z.object({ username: z.string() }),
		response: publicUser,
	},
	"repos/list-for-user": {
		method: "GET",
		path: "/users/{username}/repos",
		docs: `${DOCS}/repos/repos#list-repositories-for-a-user`,
		params: z.object({ username: z.string() }),
		query: pagination.extend({ sort: repoListSort, direction }),
		response: z.array(repository),
	},

	// Repositories, branches, tags
	"repos/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}",
		docs: `${DOCS}/repos/repos#get-a-repository`,
		params: repoParams,
		response: repository,
	},
	"repos/list-branches": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches",
		docs: `${DOCS}/branches/branches#list-branches`,
		params: repoParams,
		query: pagination,
		response: z.array(shortBranch),
	},
	"repos/get-branch": {
		method: "GET",
		path: "/repos/{owner}/{repo}/branches/{+branch}",
		docs: `${DOCS}/branches/branches#get-a-branch`,
		params: repoParams.extend({ branch: z.string().min(1) }),
		response: branch,
	},
	"repos/list-tags": {
		method: "GET",
		path: "/repos/{owner}/{repo}/tags",
		docs: `${DOCS}/repos/repos#list-repository-tags`,
		params: repoParams,
		query: pagination,
		response: z.array(tag),
	},

	// Contents and commits
	"repos/get-content": {
		method: "GET",
		path: "/repos/{owner}/{repo}/contents/{+path}",
		docs: `${DOCS}/repos/contents#get-repository-content`,
		params: repoParams.extend({ path: z.string().default("") }),
		query: z.object({ ref: z.string().optional() }),
		response: contents,
	},
	"repos/list-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits",
		docs: `${DOCS}/commits/commits#list-commits`,
		params: repoParams,
		query: pagination.extend({
			sha: z.string().optional(),
			path: z.string().optional(),
		}),
		response: z.array(commit),
	},
	"repos/get-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/commits/{+ref}",
		docs: `${DOCS}/commits/commits#get-a-commit`,
		params: repoParams.extend({ ref: z.string().min(1) }),
		response: commitDetail,
	},
	"repos/compare-commits-with-basehead": {
		method: "GET",
		path: "/repos/{owner}/{repo}/compare/{+basehead}",
		docs: `${DOCS}/commits/commits#compare-two-commits`,
		params: repoParams.extend({ basehead: z.string().min(1) }),
		query: z.object({
			page: positiveInt.optional().catch(undefined),
			per_page: positiveInt.optional().catch(undefined),
		}),
		response: comparison,
	},

	// Git database (read-only)
	"git/get-ref": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/ref/{+ref}",
		docs: `${DOCS}/git/refs#get-a-reference`,
		params: repoParams.extend({ ref: z.string().min(1) }),
		response: gitRef,
	},
	"git/list-refs": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/refs/{+ref}",
		docs: `${DOCS}/git/refs#get-a-reference`,
		/** Legacy: an exact match is one ref, a prefix an array. */
		params: repoParams.extend({ ref: z.string().optional() }),
		response: z.union([gitRef, z.array(gitRef)]),
	},
	"git/list-matching-refs": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/matching-refs/{+ref}",
		docs: `${DOCS}/git/refs#list-matching-references`,
		params: repoParams.extend({ ref: z.string().default("") }),
		response: z.array(gitRef),
	},
	"git/get-commit": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/commits/{commit_sha}",
		docs: `${DOCS}/git/commits#get-a-commit-object`,
		params: repoParams.extend({ commit_sha: z.string() }),
		response: gitCommit,
	},
	"git/get-tree": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/trees/{+tree_sha}",
		docs: `${DOCS}/git/trees#get-a-tree`,
		params: repoParams.extend({ tree_sha: z.string().min(1) }),
		/** Any value (even empty) means recursive, as on GitHub. */
		query: z.object({ recursive: z.string().optional() }),
		response: gitTree,
	},
	"git/get-blob": {
		method: "GET",
		path: "/repos/{owner}/{repo}/git/blobs/{file_sha}",
		docs: `${DOCS}/git/blobs#get-a-blob`,
		params: repoParams.extend({ file_sha: z.string() }),
		response: blob,
	},

	// Issues
	"issues/list-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues",
		docs: `${DOCS}/issues/issues#list-repository-issues`,
		params: repoParams,
		query: pagination.extend({
			state: listState,
			/** A login, `none` (unassigned) or `*` (anyone). */
			assignee: z.string().max(100).optional(),
			labels: commaList(labelName, MAX_LABELS_PER_THREAD).optional(),
			sort: z
				.enum(["created", "updated", "comments"])
				.default("created")
				.catch("created"),
			direction: z.enum(["asc", "desc"]).default("desc").catch("desc"),
		}),
		response: z.array(issue),
	},
	"issues/create": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues",
		docs: `${DOCS}/issues/issues#create-an-issue`,
		status: 201,
		params: repoParams,
		body: z.object({
			title: threadTitle,
			body: threadBody.nullish(),
			labels: labelNames.optional(),
			assignees: assigneeLogins.optional(),
		}),
		response: issue,
	},
	"issues/get-comment": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#get-an-issue-comment`,
		params: commentParams,
		response: issueComment,
	},
	"issues/update-comment": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#update-an-issue-comment`,
		params: commentParams,
		body: z.object({ body: commentBody }),
		response: issueComment,
	},
	"issues/delete-comment": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
		docs: `${DOCS}/issues/comments#delete-an-issue-comment`,
		status: 204,
		params: commentParams,
		response: noContent,
	},
	"issues/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}",
		docs: `${DOCS}/issues/issues#get-an-issue`,
		params: issueParams,
		response: issue,
	},
	"issues/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/issues/{issue_number}",
		docs: `${DOCS}/issues/issues#update-an-issue`,
		params: issueParams,
		body: z.object({
			title: threadTitle.optional(),
			body: threadBody.nullish(),
			state: z.enum(["open", "closed"]).optional(),
			state_reason: stateReason.nullish(),
			labels: labelNames.optional(),
			assignees: assigneeLogins.optional(),
		}),
		response: issue,
	},
	"issues/list-comments": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
		docs: `${DOCS}/issues/comments#list-issue-comments`,
		params: issueParams,
		query: pagination,
		response: z.array(issueComment),
	},
	"issues/create-comment": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
		docs: `${DOCS}/issues/comments#create-an-issue-comment`,
		status: 201,
		params: issueParams,
		body: z.object({ body: commentBody }),
		response: issueComment,
	},
	"issues/list-events-for-timeline": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/timeline",
		docs: `${DOCS}/issues/timeline#list-timeline-events-for-an-issue`,
		params: issueParams,
		query: pagination,
		response: z.array(timelineItem),
	},
	"issues/list-events": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/events",
		docs: `${DOCS}/issues/events#list-issue-events`,
		params: issueParams,
		query: pagination,
		response: z.array(issueEvent),
	},
	"issues/list-labels-on-issue": {
		method: "GET",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#list-labels-for-an-issue`,
		params: issueParams,
		response: z.array(label),
	},
	"issues/add-labels": {
		method: "POST",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#add-labels-to-an-issue`,
		params: issueParams,
		body: z.object({ labels: labelNames }),
		response: z.array(label),
	},
	"issues/set-labels": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#set-labels-for-an-issue`,
		params: issueParams,
		body: z.object({ labels: labelNames }),
		response: z.array(label),
	},
	"issues/remove-all-labels": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		docs: `${DOCS}/issues/labels#remove-all-labels-from-an-issue`,
		status: 204,
		params: issueParams,
		response: noContent,
	},
	"issues/remove-label": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}",
		docs: `${DOCS}/issues/labels#remove-a-label-from-an-issue`,
		params: issueParams.extend({ name: z.string().min(1) }),
		response: z.array(label),
	},

	// Pull requests
	"pulls/list": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls",
		docs: `${DOCS}/pulls/pulls#list-pull-requests`,
		params: repoParams,
		query: pagination.extend({
			state: listState,
			/** `branch` or `owner:branch`. */
			head: z.string().optional(),
			base: z.string().optional(),
			sort: z
				.enum(["created", "updated", "popularity", "long-running"])
				.default("created")
				.catch("created"),
			direction,
		}),
		response: z.array(pullRequestSimple),
	},
	"pulls/create": {
		method: "POST",
		path: "/repos/{owner}/{repo}/pulls",
		docs: `${DOCS}/pulls/pulls#create-a-pull-request`,
		status: 201,
		params: repoParams,
		body: z.object({
			title: threadTitle,
			body: threadBody.nullish(),
			head: z.string().min(1).max(300),
			base: z.string().min(1).max(300),
		}),
		response: pullRequest,
	},
	"pulls/get": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}",
		docs: `${DOCS}/pulls/pulls#get-a-pull-request`,
		params: pullParams,
		response: pullRequest,
	},
	"pulls/update": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}",
		docs: `${DOCS}/pulls/pulls#update-a-pull-request`,
		params: pullParams,
		body: z.object({
			title: threadTitle.optional(),
			body: threadBody.nullish(),
			state: z.enum(["open", "closed"]).optional(),
			base: z.string().min(1).max(300).optional(),
		}),
		response: pullRequest,
	},
	"pulls/check-if-merged": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/merge",
		docs: `${DOCS}/pulls/pulls#check-if-a-pull-request-has-been-merged`,
		/** 204 when merged, 404 when not. */
		status: 204,
		params: pullParams,
		response: noContent,
	},
	"pulls/merge": {
		method: "PUT",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/merge",
		docs: `${DOCS}/pulls/pulls#merge-a-pull-request`,
		params: pullParams,
		body: z.object({
			commit_title: z.string().max(MAX_COMMIT_MESSAGE_CHARS).nullish(),
			commit_message: z.string().max(MAX_COMMIT_MESSAGE_CHARS).nullish(),
			/** The head the merge expects; 409 when the branch moved. */
			sha: z.string().max(100).nullish(),
			/** Only `merge` is allowed (405 otherwise). */
			merge_method: z.enum(["merge", "squash", "rebase"]).nullish(),
		}),
		response: mergeResult,
	},
	"pulls/list-commits": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/commits",
		docs: `${DOCS}/pulls/pulls#list-commits-on-a-pull-request`,
		params: pullParams,
		query: pagination,
		response: z.array(commit),
	},
	"pulls/list-files": {
		method: "GET",
		path: "/repos/{owner}/{repo}/pulls/{pull_number}/files",
		docs: `${DOCS}/pulls/pulls#list-pull-requests-files`,
		params: pullParams,
		query: pagination,
		response: z.array(diffEntry),
	},

	// Labels
	"issues/list-labels-for-repo": {
		method: "GET",
		path: "/repos/{owner}/{repo}/labels",
		docs: `${DOCS}/issues/labels#list-labels-for-a-repository`,
		params: repoParams,
		query: pagination,
		response: z.array(label),
	},
	"issues/create-label": {
		method: "POST",
		path: "/repos/{owner}/{repo}/labels",
		docs: `${DOCS}/issues/labels#create-a-label`,
		status: 201,
		params: repoParams,
		body: z.object({
			name: labelName,
			color: labelColor.default("ededed"),
			description: labelDescription.nullish(),
		}),
		response: label,
	},
	"issues/get-label": {
		method: "GET",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#get-a-label`,
		params: labelParams,
		response: label,
	},
	"issues/update-label": {
		method: "PATCH",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#update-a-label`,
		params: labelParams,
		body: z.object({
			new_name: labelName.optional(),
			color: labelColor.optional(),
			description: labelDescription.nullish(),
		}),
		response: label,
	},
	"issues/delete-label": {
		method: "DELETE",
		path: "/repos/{owner}/{repo}/labels/{name}",
		docs: `${DOCS}/issues/labels#delete-a-label`,
		status: 204,
		params: labelParams,
		response: noContent,
	},
});

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;
