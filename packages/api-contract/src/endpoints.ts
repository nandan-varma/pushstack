/**
 * What each operation of {@link routes} takes and returns: path params,
 * query and body schemas (servers parse with them) and the response schema.
 */
import { z } from "zod";
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
	queryBoolean,
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
	fileCommit,
	gitCommit,
	gitRef,
	gitTree,
	issue,
	issueComment,
	issueEvent,
	label,
	mergeResult,
	notificationThread,
	privateUser,
	publicUser,
	pullRequest,
	pullRequestSimple,
	rateLimitOverview,
	reaction,
	reactionContent,
	repository,
	shortBranch,
	stateReason,
	tag,
	threadSubscription,
	timelineItem,
} from "./resources";
import type { EndpointInput, EndpointResponse, Schemas } from "./route";
import { type OperationId, routes } from "./routes";

/** Merges each route with its schemas; every route must have them. */
function defineEndpoints<const T extends { [Id in OperationId]: Schemas }>(
	schemas: T,
) {
	return Object.fromEntries(
		Object.entries(routes).map(([id, route]) => [
			id,
			{ ...route, ...schemas[id as OperationId] },
		]),
	) as { [Id in OperationId]: (typeof routes)[Id] & T[Id] };
}

const noContent = z.null();

const commitMessage = z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS);
/** A commit's author or committer; `date` is accepted and ignored (commits are dated now). */
const commitIdentity = z.object({
	name: z.string().min(1).max(255),
	email: z.string().min(1).max(255),
	date: z.string().optional(),
});

const threadParams = z.object({ thread_id: positiveInt });
const isoDate = z.iso.datetime({ offset: true });
/** GitHub's notification list parameters; `per_page` tops out at 50. */
const notificationQuery = z.object({
	all: queryBoolean,
	participating: queryBoolean,
	since: isoDate.optional(),
	before: isoDate.optional(),
	page: positiveInt.optional().catch(undefined),
	per_page: positiveInt
		.optional()
		.catch(undefined)
		.transform((value) => Math.min(value ?? 50, 50)),
});
const markReadBody = z.object({
	/** Default: now. */
	last_read_at: isoDate.optional(),
	read: z.boolean().optional(),
});
const listState = z.enum(["open", "closed", "all"]).default("open");
const commentParams = repoParams.extend({ comment_id: positiveInt });
const reactionList = {
	query: pagination.extend({ content: reactionContent.optional() }),
	response: z.array(reaction),
};
const reactionBody = z.object({ content: reactionContent });
const labelParams = repoParams.extend({ name: z.string().min(1) });
const repoListSort = z
	.enum(["created", "updated", "pushed", "full_name"])
	.optional()
	.catch(undefined);

export const endpoints = defineEndpoints({
	"rate-limit/get": {
		response: rateLimitOverview,
	},

	"users/get-authenticated": {
		response: privateUser,
	},
	"repos/list-for-authenticated-user": {
		query: pagination.extend({
			visibility: z.enum(["all", "public", "private"]).optional(),
			/** Every comma-separated value must be valid (an empty one too). */
			affiliation: z
				.union([z.array(z.string()), z.string()])
				.transform((value) =>
					(Array.isArray(value) ? value : value.split(",")).map((part) =>
						part.trim(),
					),
				)
				.pipe(
					z
						.array(z.enum(["owner", "collaborator", "organization_member"]))
						.min(1),
				)
				.optional(),
			type: z.enum(["all", "owner", "public", "private", "member"]).optional(),
			sort: repoListSort,
			direction,
		}),
		response: z.array(repository),
	},
	"repos/create-for-authenticated-user": {
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
		params: z.object({ account_id: positiveInt }),
		response: publicUser,
	},
	"users/get-by-username": {
		params: z.object({ username: z.string() }),
		response: publicUser,
	},
	"repos/list-for-user": {
		params: z.object({ username: z.string() }),
		query: pagination.extend({ sort: repoListSort, direction }),
		response: z.array(repository),
	},

	"activity/list-notifications-for-authenticated-user": {
		query: notificationQuery,
		response: z.array(notificationThread),
	},
	"activity/mark-notifications-as-read": {
		body: markReadBody,
		response: noContent,
	},
	"activity/get-thread-subscription-for-authenticated-user": {
		params: threadParams,
		response: threadSubscription,
	},
	"activity/set-thread-subscription": {
		params: threadParams,
		body: z.object({ ignored: z.boolean().default(false) }),
		response: threadSubscription,
	},
	"activity/delete-thread-subscription": {
		params: threadParams,
		response: noContent,
	},
	"activity/get-thread": {
		params: threadParams,
		response: notificationThread,
	},
	"activity/mark-thread-as-read": {
		params: threadParams,
		response: noContent,
	},
	"activity/mark-thread-as-done": {
		params: threadParams,
		response: noContent,
	},
	"repos/get": {
		params: repoParams,
		response: repository,
	},
	"activity/list-repo-notifications-for-authenticated-user": {
		params: repoParams,
		query: notificationQuery,
		response: z.array(notificationThread),
	},
	"activity/mark-repo-notifications-as-read": {
		params: repoParams,
		body: markReadBody,
		response: noContent,
	},
	"repos/list-branches": {
		params: repoParams,
		query: pagination,
		response: z.array(shortBranch),
	},
	"repos/get-branch": {
		params: repoParams.extend({ branch: z.string().min(1) }),
		response: branch,
	},
	"repos/list-tags": {
		params: repoParams,
		query: pagination,
		response: z.array(tag),
	},

	"repos/get-content": {
		params: repoParams.extend({ path: z.string().default("") }),
		query: z.object({ ref: z.string().optional() }),
		response: contents,
	},
	"repos/create-or-update-file-contents": {
		params: repoParams.extend({ path: z.string().min(1) }),
		body: z.object({
			message: commitMessage,
			/** Base64, line breaks allowed; the API's request body cap bounds its size. */
			content: z
				.string()
				.transform((text) => text.replace(/[\r\n]/g, ""))
				.pipe(z.base64()),
			/** The blob being replaced; required when the file exists. */
			sha: z.string().max(100).optional(),
			branch: z.string().max(255).optional(),
			committer: commitIdentity.optional(),
			author: commitIdentity.optional(),
		}),
		response: fileCommit,
	},
	"repos/delete-file": {
		params: repoParams.extend({ path: z.string().min(1) }),
		body: z.object({
			message: commitMessage,
			sha: z.string().max(100),
			branch: z.string().max(255).optional(),
			committer: commitIdentity.optional(),
			author: commitIdentity.optional(),
		}),
		response: fileCommit,
	},
	"repos/list-commits": {
		params: repoParams,
		query: pagination.extend({
			sha: z.string().optional(),
			path: z.string().optional(),
			/** A login or an email. */
			author: z.string().max(255).optional(),
			committer: z.string().max(255).optional(),
			since: z.iso.datetime({ offset: true }).optional(),
			until: z.iso.datetime({ offset: true }).optional(),
		}),
		response: z.array(commit),
	},
	"repos/get-commit": {
		params: repoParams.extend({ ref: z.string().min(1) }),
		response: commitDetail,
	},
	"repos/compare-commits-with-basehead": {
		params: repoParams.extend({ basehead: z.string().min(1) }),
		query: z.object({
			page: positiveInt.optional().catch(undefined),
			per_page: positiveInt.optional().catch(undefined),
		}),
		response: comparison,
	},

	"git/get-ref": {
		params: repoParams.extend({ ref: z.string().min(1) }),
		response: gitRef,
	},
	"git/list-refs": {
		/** Legacy: an exact match is one ref, a prefix an array. */
		params: repoParams.extend({ ref: z.string().optional() }),
		response: z.union([gitRef, z.array(gitRef)]),
	},
	"git/list-matching-refs": {
		params: repoParams.extend({ ref: z.string().default("") }),
		response: z.array(gitRef),
	},
	"git/delete-ref": {
		params: repoParams.extend({ ref: z.string().min(1) }),
		response: noContent,
	},
	"git/get-commit": {
		params: repoParams.extend({ commit_sha: z.string() }),
		response: gitCommit,
	},
	"git/get-tree": {
		params: repoParams.extend({ tree_sha: z.string().min(1) }),
		/** Any value (even empty) means recursive, as on GitHub. */
		query: z.object({ recursive: z.string().optional() }),
		response: gitTree,
	},
	"git/get-blob": {
		params: repoParams.extend({ file_sha: z.string() }),
		response: blob,
	},

	"issues/list-for-repo": {
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
		params: commentParams,
		response: issueComment,
	},
	"issues/update-comment": {
		params: commentParams,
		body: z.object({ body: commentBody }),
		response: issueComment,
	},
	"issues/delete-comment": {
		params: commentParams,
		response: noContent,
	},
	"reactions/list-for-issue-comment": {
		params: commentParams,
		...reactionList,
	},
	"reactions/create-for-issue-comment": {
		params: commentParams,
		body: reactionBody,
		response: reaction,
	},
	"reactions/delete-for-issue-comment": {
		params: commentParams.extend({ reaction_id: positiveInt }),
		response: noContent,
	},
	"issues/get": {
		params: issueParams,
		response: issue,
	},
	"issues/update": {
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
		params: issueParams,
		query: pagination,
		response: z.array(issueComment),
	},
	"issues/create-comment": {
		params: issueParams,
		body: z.object({ body: commentBody }),
		response: issueComment,
	},
	"issues/list-events-for-timeline": {
		params: issueParams,
		query: pagination,
		response: z.array(timelineItem),
	},
	"issues/list-events": {
		params: issueParams,
		query: pagination,
		response: z.array(issueEvent),
	},
	"reactions/list-for-issue": { params: issueParams, ...reactionList },
	"reactions/create-for-issue": {
		params: issueParams,
		body: reactionBody,
		response: reaction,
	},
	"reactions/delete-for-issue": {
		params: issueParams.extend({ reaction_id: positiveInt }),
		response: noContent,
	},
	"issues/list-labels-on-issue": {
		params: issueParams,
		response: z.array(label),
	},
	"issues/add-labels": {
		params: issueParams,
		body: z.object({ labels: labelNames }),
		response: z.array(label),
	},
	"issues/set-labels": {
		params: issueParams,
		body: z.object({ labels: labelNames }),
		response: z.array(label),
	},
	"issues/remove-all-labels": {
		params: issueParams,
		response: noContent,
	},
	"issues/remove-label": {
		params: issueParams.extend({ name: z.string().min(1) }),
		response: z.array(label),
	},

	"pulls/list": {
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
		params: pullParams,
		response: pullRequest,
	},
	"pulls/update": {
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
		params: pullParams,
		response: noContent,
	},
	"pulls/merge": {
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
		params: pullParams,
		query: pagination,
		response: z.array(commit),
	},
	"pulls/list-files": {
		params: pullParams,
		query: pagination,
		response: z.array(diffEntry),
	},

	"issues/list-labels-for-repo": {
		params: repoParams,
		query: pagination,
		response: z.array(label),
	},
	"issues/create-label": {
		params: repoParams,
		body: z.object({
			name: labelName,
			color: labelColor.default("ededed"),
			description: labelDescription.nullish(),
		}),
		response: label,
	},
	"issues/get-label": {
		params: labelParams,
		response: label,
	},
	"issues/update-label": {
		params: labelParams,
		body: z.object({
			new_name: labelName.optional(),
			color: labelColor.optional(),
			description: labelDescription.nullish(),
		}),
		response: label,
	},
	"issues/delete-label": {
		params: labelParams,
		response: noContent,
	},
});

export type Endpoints = typeof endpoints;
export type Input<Id extends OperationId> = EndpointInput<Endpoints[Id]>;
export type Output<Id extends OperationId> = EndpointResponse<Endpoints[Id]>;

/** `[input]`, or `[input?]` when nothing is required. */
export type InputArgs<Id extends OperationId> =
	Record<string, never> extends Input<Id>
		? [input?: Input<Id>]
		: [input: Input<Id>];

/** Operations returning one page of a list (they take `page`/`per_page`). */
export type ListOperationId = {
	[Id in OperationId]: Output<Id> extends unknown[]
		? Input<Id> extends { per_page?: unknown }
			? Id
			: never
		: never;
}[OperationId];
