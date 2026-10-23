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
	MAX_CHECK_NAME_CHARS,
	MAX_CHECK_OUTPUT_CHARS,
	MAX_CHECK_TITLE_CHARS,
	MAX_COMMENT_PATH_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_REPO_DESCRIPTION_CHARS,
	MAX_REPORT_URL_CHARS,
	MAX_STATUS_CONTEXT_CHARS,
	MAX_STATUS_DESCRIPTION_CHARS,
} from "./limits";
import {
	blob,
	branch,
	checkRun,
	checkSuite,
	combinedCommitStatus,
	commit,
	commitComment,
	commitDetail,
	commitStatus,
	comparison,
	contents,
	createdBlob,
	diffEntry,
	fileCommit,
	gitCommit,
	gitRef,
	gitTag,
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

/** Entries one `POST …/git/trees` may carry (the request body cap binds first). */
const MAX_TREE_ENTRIES = 10_000;
/** Parents of one commit: octopus merges, not unbounded lists. */
const MAX_COMMIT_PARENTS = 100;
const commitMessage = z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS);
/** A commit's author or committer; `date` (ISO 8601) is honored by the Git database API, ignored by contents writes. */
const commitIdentity = z.object({
	name: z.string().min(1).max(255),
	email: z.string().min(1).max(255),
	date: z.iso.datetime({ offset: true }).optional(),
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
/** A full or abbreviated sha; the handler resolves it (unknown = 422). */
const commitShaParams = repoParams.extend({
	commit_sha: z.string().min(1).max(100),
});
const refParams = repoParams.extend({ ref: z.string().min(1).max(255) });
const checkRunParams = repoParams.extend({ check_run_id: positiveInt });
const checkSuiteParams = repoParams.extend({ check_suite_id: positiveInt });
/** An absolute http(s) URL a CI links its report to. */
const reportUrl = z
	.string()
	.max(MAX_REPORT_URL_CHARS)
	.refine((value) => {
		try {
			return ["http:", "https:"].includes(new URL(value).protocol);
		} catch {
			return false;
		}
	}, "Must be an http(s) URL");
const checkStatus = z.enum(["queued", "in_progress", "completed"]);
const checkConclusion = z.enum([
	"action_required",
	"cancelled",
	"failure",
	"neutral",
	"success",
	"skipped",
	"stale",
	"timed_out",
]);
const checkOutput = z.object({
	title: z.string().min(1).max(MAX_CHECK_TITLE_CHARS),
	summary: z.string().min(1).max(MAX_CHECK_OUTPUT_CHARS),
	text: z.string().max(MAX_CHECK_OUTPUT_CHARS).optional(),
});
const checkRunFields = {
	details_url: reportUrl.optional(),
	external_id: z.string().max(MAX_CHECK_NAME_CHARS).optional(),
	status: checkStatus.optional(),
	started_at: isoDate.optional(),
	conclusion: checkConclusion.optional(),
	completed_at: isoDate.optional(),
	output: checkOutput.optional(),
};
const checkRunList = {
	query: pagination.extend({
		check_name: z.string().max(MAX_CHECK_NAME_CHARS).optional(),
		status: checkStatus.optional().catch(undefined),
		filter: z.enum(["latest", "all"]).optional().catch(undefined),
	}),
};
const checkRunsResponse = z.object({
	total_count: z.number().int().nonnegative(),
	check_runs: z.array(checkRun),
});
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
	/** URL templates for the endpoints served, keyed as on GitHub. */
	"meta/root": {
		response: z.record(z.string().regex(/_url$/), z.string()),
	},
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
	"repos/download-tarball-archive": {
		params: repoParams.extend({ ref: z.string().default("") }),
		response: noContent,
	},
	"repos/download-zipball-archive": {
		params: repoParams.extend({ ref: z.string().default("") }),
		response: noContent,
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
	"repos/list-commit-comments-for-repo": {
		params: repoParams,
		query: pagination,
		response: z.array(commitComment),
	},
	"repos/get-commit-comment": {
		params: commentParams,
		response: commitComment,
	},
	"repos/update-commit-comment": {
		params: commentParams,
		body: z.object({ body: commentBody }),
		response: commitComment,
	},
	"repos/delete-commit-comment": {
		params: commentParams,
		response: noContent,
	},
	"repos/list-comments-for-commit": {
		params: commitShaParams,
		query: pagination,
		response: z.array(commitComment),
	},
	"repos/create-commit-comment": {
		params: commitShaParams,
		body: z.object({
			body: commentBody,
			path: z.string().min(1).max(MAX_COMMENT_PATH_CHARS).optional(),
			position: positiveInt.optional(),
			/** Deprecated on GitHub; stored and echoed. */
			line: positiveInt.optional(),
		}),
		response: commitComment,
	},
	"repos/create-commit-status": {
		params: repoParams.extend({ sha: z.string().min(1).max(100) }),
		body: z.object({
			state: z.enum(["error", "failure", "pending", "success"]),
			target_url: reportUrl.nullish(),
			description: z.string().max(MAX_STATUS_DESCRIPTION_CHARS).nullish(),
			context: z.string().min(1).max(MAX_STATUS_CONTEXT_CHARS).optional(),
		}),
		response: commitStatus,
	},
	"repos/list-commit-statuses-for-ref": {
		params: refParams,
		query: pagination,
		response: z.array(commitStatus),
	},
	"repos/get-combined-status-for-ref": {
		params: refParams,
		query: pagination,
		response: combinedCommitStatus,
	},
	"checks/list-for-ref": {
		params: refParams,
		...checkRunList,
		response: checkRunsResponse,
	},
	"checks/list-suites-for-ref": {
		params: refParams,
		query: pagination,
		response: z.object({
			total_count: z.number().int().nonnegative(),
			check_suites: z.array(checkSuite),
		}),
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
	"checks/create": {
		params: repoParams,
		body: z.object({
			name: z.string().min(1).max(MAX_CHECK_NAME_CHARS),
			head_sha: z.string().min(1).max(100),
			...checkRunFields,
		}),
		response: checkRun,
	},
	"checks/get": { params: checkRunParams, response: checkRun },
	"checks/update": {
		params: checkRunParams,
		body: z.object({
			name: z.string().min(1).max(MAX_CHECK_NAME_CHARS).optional(),
			...checkRunFields,
		}),
		response: checkRun,
	},
	"checks/create-suite": {
		params: repoParams,
		body: z.object({ head_sha: z.string().min(1).max(100) }),
		response: checkSuite,
	},
	"checks/get-suite": { params: checkSuiteParams, response: checkSuite },
	"checks/list-for-suite": {
		params: checkSuiteParams,
		...checkRunList,
		response: checkRunsResponse,
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
	"git/create-ref": {
		params: repoParams,
		body: z.object({
			ref: z.string().min(1).max(255),
			sha: z.string().max(100),
		}),
		response: gitRef,
	},
	"git/update-ref": {
		params: repoParams.extend({ ref: z.string().min(1) }),
		body: z.object({
			sha: z.string().max(100),
			force: z.boolean().default(false),
		}),
		response: gitRef,
	},
	"git/create-blob": {
		params: repoParams,
		body: z.object({
			content: z.string(),
			encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
		}),
		response: createdBlob,
	},
	"git/create-tree": {
		params: repoParams,
		body: z.object({
			tree: z
				.array(
					z.object({
						path: z.string().min(1).max(4096),
						mode: z.enum(["100644", "100755", "040000", "160000", "120000"]),
						type: z.enum(["blob", "tree", "commit"]),
						sha: z.string().max(100).nullable().optional(),
						content: z.string().optional(),
					}),
				)
				.max(MAX_TREE_ENTRIES),
			base_tree: z.string().max(100).optional(),
		}),
		response: gitTree,
	},
	"git/create-commit": {
		params: repoParams,
		body: z.object({
			message: commitMessage,
			tree: z.string().max(100),
			parents: z.array(z.string().max(100)).max(MAX_COMMIT_PARENTS).default([]),
			author: commitIdentity.optional(),
			committer: commitIdentity.optional(),
		}),
		response: gitCommit,
	},
	"git/get-tag": {
		params: repoParams.extend({ tag_sha: z.string() }),
		response: gitTag,
	},
	"git/create-tag": {
		params: repoParams,
		body: z.object({
			tag: z.string().min(1).max(255),
			message: z.string().max(MAX_COMMIT_MESSAGE_CHARS),
			object: z.string().max(100),
			type: z.enum(["commit", "tree", "blob", "tag"]),
			tagger: commitIdentity.optional(),
		}),
		response: gitTag,
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
