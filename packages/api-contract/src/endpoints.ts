/**
 * What each operation of {@link routes} takes and returns: path params,
 * query and body schemas (servers parse with them) and the response schema.
 */
import { z } from "zod";
import {
	assigneeLogin,
	assigneeLogins,
	commaList,
	commentBody,
	direction,
	issueParams,
	labelColor,
	labelDescription,
	labelName,
	labelNames,
	milestoneDescription,
	milestoneDueOn,
	milestoneRef,
	milestoneTitle,
	pagination,
	positiveInt,
	pullParams,
	queryBoolean,
	repoName,
	repoParams,
	reviewerLogins,
	threadBody,
	threadTitle,
	unsupported,
	unsupportedUnless,
} from "./inputs";
import {
	MAX_BODY_CHARS,
	MAX_CHECK_NAME_CHARS,
	MAX_CHECK_OUTPUT_CHARS,
	MAX_CHECK_TITLE_CHARS,
	MAX_COMMENT_PATH_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_RELEASE_ASSET_BYTES,
	MAX_RELEASE_ASSET_LABEL_CHARS,
	MAX_RELEASE_ASSET_NAME_CHARS,
	MAX_RELEASE_NAME_CHARS,
	MAX_RELEASE_TAG_CHARS,
	MAX_REPO_DESCRIPTION_CHARS,
	MAX_REPO_HOMEPAGE_CHARS,
	MAX_REPO_TOPIC_CHARS,
	MAX_REPO_TOPICS,
	MAX_REPORT_URL_CHARS,
	MAX_SEARCH_QUERY_CHARS,
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
	milestone,
	notificationThread,
	privateUser,
	publicUser,
	pullRequest,
	pullRequestSimple,
	rateLimitOverview,
	reaction,
	reactionContent,
	release,
	releaseAsset,
	releaseNotes,
	repository,
	repositorySubscription,
	requestedReviewers,
	shortBranch,
	simpleUser,
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
const topicList = z.strictObject({ names: z.array(z.string()) });

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
const usernameParams = z.object({ username: z.string() });
const followTargetParams = usernameParams.extend({ target_user: z.string() });
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
});
/** `read: true` is the default (mark read); GitHub's `false` is not implemented. */
const markAllReadBody = markReadBody.extend({
	read: unsupportedUnless((value) => value === true),
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
	/** Empty is a no-op (no annotations or images are served); otherwise `422`. */
	annotations: unsupportedUnless(
		(value) => Array.isArray(value) && value.length === 0,
	),
	images: unsupportedUnless(
		(value) => Array.isArray(value) && value.length === 0,
	),
});
const checkRunFields = {
	details_url: reportUrl.optional(),
	external_id: z.string().max(MAX_CHECK_NAME_CHARS).optional(),
	status: checkStatus.optional(),
	started_at: isoDate.optional(),
	conclusion: checkConclusion.optional(),
	completed_at: isoDate.optional(),
	output: checkOutput.optional(),
	actions: unsupported,
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
const milestoneParams = repoParams.extend({ milestone_number: positiveInt });
const labelParams = repoParams.extend({ name: z.string().min(1) });
const releaseParams = repoParams.extend({ release_id: positiveInt });
const assetParams = repoParams.extend({ asset_id: positiveInt });
const releaseTagName = z.string().min(1).max(MAX_RELEASE_TAG_CHARS);
const releaseFields = {
	discussion_category_name: unsupported,
	target_commitish: z.string().min(1).max(300).optional(),
	name: z.string().max(MAX_RELEASE_NAME_CHARS).nullish(),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	draft: z.boolean().optional(),
	prerelease: z.boolean().optional(),
	/** GitHub's `"true"`, `"false"` or `"legacy"`; booleans are accepted too. */
	make_latest: z
		.union([z.enum(["true", "false", "legacy"]), z.boolean()])
		.transform((value) => String(value) as "true" | "false" | "legacy")
		.optional(),
};
const assetName = z.string().trim().min(1).max(MAX_RELEASE_ASSET_NAME_CHARS);
const assetLabel = z.string().max(MAX_RELEASE_ASSET_LABEL_CHARS);
/** GitHub's search envelope: `total_count` is exact, `items` is one page. */
const searchResult = <T extends z.ZodType>(item: T) =>
	z.strictObject({
		total_count: z.number().int().nonnegative(),
		incomplete_results: z.literal(false),
		items: z.array(item),
	});

const repoListSort = z
	.enum(["created", "updated", "pushed", "full_name"])
	.optional()
	.catch(undefined);

export const endpoints = defineEndpoints({
	/** URL templates for the endpoints served, keyed as on GitHub. */
	"meta/root": {
		response: z.record(z.string().regex(/_url$/), z.string()),
	},
	"meta/get": {
		response: z.strictObject({ installed_version: z.string() }),
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
			since: isoDate.optional(),
			before: isoDate.optional(),
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
			homepage: z.string().trim().max(MAX_REPO_HOMEPAGE_CHARS).nullish(),
			has_issues: z.boolean().optional(),
			has_projects: z.boolean().optional(),
			has_wiki: z.boolean().optional(),
			is_template: z.boolean().optional(),
			allow_auto_merge: unsupported,
			allow_merge_commit: unsupported,
			allow_rebase_merge: unsupported,
			allow_squash_merge: unsupported,
			delete_branch_on_merge: unsupported,
			has_discussions: unsupported,
			has_downloads: unsupported,
			merge_commit_message: unsupported,
			merge_commit_title: unsupported,
			squash_merge_commit_message: unsupported,
			squash_merge_commit_title: unsupported,
			team_id: unsupported,
		}),
		response: repository,
	},
	"users/list-followers-for-authenticated-user": {
		query: pagination,
		response: z.array(simpleUser),
	},
	"users/list-followed-by-authenticated-user": {
		query: pagination,
		response: z.array(simpleUser),
	},
	"users/check-person-is-followed-by-authenticated": {
		params: usernameParams,
		response: noContent,
	},
	"users/follow": { params: usernameParams, response: noContent },
	"users/unfollow": { params: usernameParams, response: noContent },
	"activity/list-watched-repos-for-authenticated-user": {
		query: pagination,
		response: z.array(repository),
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
		query: pagination.extend({
			/** GitHub's default is `owner`. */
			type: z.enum(["all", "owner", "member"]).optional(),
			sort: repoListSort,
			direction,
		}),
		response: z.array(repository),
	},

	"search/repos": {
		query: pagination.extend({
			/** The query: words (name and description), user:/org:, is:public|private, topic:. */
			q: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS),
			sort: z.enum(["updated"]).optional(),
			order: direction,
		}),
		response: searchResult(repository),
	},
	"search/issues-and-pull-requests": {
		query: pagination.extend({
			// GitHub's advanced (lexical, semantic) search: refused, never silently ignored.
			advanced_search: unsupported,
			search_type: unsupported,
			/** The query: GitHub's issue and pull request syntax, across the repositories the caller can read. */
			q: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS),
			sort: z.enum(["created", "updated", "comments"]).optional(),
			order: direction,
		}),
		response: searchResult(issue),
	},
	"users/list-followers-for-user": {
		params: usernameParams,
		query: pagination,
		response: z.array(simpleUser),
	},
	"users/list-following-for-user": {
		params: usernameParams,
		query: pagination,
		response: z.array(simpleUser),
	},
	"users/check-following-for-user": {
		params: followTargetParams,
		response: noContent,
	},
	"activity/list-repos-watched-by-user": {
		params: usernameParams,
		query: pagination,
		response: z.array(repository),
	},

	"activity/list-notifications-for-authenticated-user": {
		query: notificationQuery,
		response: z.array(notificationThread),
	},
	"activity/mark-notifications-as-read": {
		body: markAllReadBody,
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
	"repos/update": {
		params: repoParams,
		body: z.object({
			name: repoName.optional(),
			description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).nullish(),
			homepage: z.string().trim().max(MAX_REPO_HOMEPAGE_CHARS).nullish(),
			private: z.boolean().optional(),
			visibility: z.enum(["public", "private"]).optional(),
			has_issues: z.boolean().optional(),
			has_projects: z.boolean().optional(),
			has_wiki: z.boolean().optional(),
			is_template: z.boolean().optional(),
			default_branch: z.string().optional(),
			archived: z.boolean().optional(),
			allow_merge_commit: z.boolean().optional(),
			allow_squash_merge: z.boolean().optional(),
			allow_rebase_merge: z.boolean().optional(),
			allow_auto_merge: unsupported,
			allow_forking: unsupported,
			allow_update_branch: unsupported,
			delete_branch_on_merge: unsupported,
			has_pull_requests: unsupported,
			merge_commit_message: unsupported,
			merge_commit_title: unsupported,
			pull_request_creation_policy: unsupported,
			security_and_analysis: unsupported,
			squash_merge_commit_message: unsupported,
			squash_merge_commit_title: unsupported,
			use_squash_pr_title_as_default: unsupported,
			web_commit_signoff_required: unsupported,
		}),
		response: repository,
	},
	"repos/delete": {
		params: repoParams,
		response: noContent,
	},
	"repos/get-all-topics": {
		params: repoParams,
		query: pagination,
		response: topicList,
	},
	"repos/replace-all-topics": {
		params: repoParams,
		body: z.object({
			names: z.array(z.string().max(MAX_REPO_TOPIC_CHARS)).max(MAX_REPO_TOPICS),
		}),
		response: topicList,
	},
	"repos/transfer": {
		params: repoParams,
		body: z.object({
			new_owner: z.string().min(1),
			new_name: repoName.optional(),
			team_ids: unsupported,
		}),
		response: repository,
	},
	"repos/create-using-template": {
		params: z.object({ template_owner: z.string(), template_repo: z.string() }),
		body: z.object({
			owner: z.string().optional(),
			name: repoName,
			description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).nullish(),
			/** Only the default branch is copied; `true` is `422`. */
			include_all_branches: z.literal(false).default(false),
			private: z.boolean().default(false),
		}),
		response: repository,
	},
	"repos/list-forks": {
		params: repoParams,
		query: pagination.extend({
			/** `newest` (GitHub's default), `oldest`, or by stars (`stargazers`, `watchers`). */
			sort: z.enum(["newest", "oldest", "stargazers", "watchers"]).optional(),
		}),
		response: z.array(repository),
	},
	"repos/create-fork": {
		params: repoParams,
		body: z.object({
			organization: z.string().optional(),
			name: repoName.optional(),
			default_branch_only: z.boolean().default(false),
		}),
		response: repository,
	},
	"activity/list-watchers-for-repo": {
		params: repoParams,
		query: pagination,
		response: z.array(simpleUser),
	},
	"activity/get-repo-subscription": {
		params: repoParams,
		response: repositorySubscription,
	},
	"activity/set-repo-subscription": {
		params: repoParams,
		body: z.object({
			subscribed: z.boolean().optional(),
			ignored: z.boolean().optional(),
		}),
		response: repositorySubscription,
	},
	"activity/delete-repo-subscription": {
		params: repoParams,
		response: noContent,
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
		query: pagination.extend({ protected: unsupported }),
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

	"repos/list-releases": {
		params: repoParams,
		query: pagination,
		response: z.array(release),
	},
	"repos/create-release": {
		params: repoParams,
		body: z.object({
			tag_name: releaseTagName,
			generate_release_notes: z.boolean().optional(),
			...releaseFields,
		}),
		response: release,
	},
	"repos/generate-release-notes": {
		params: repoParams,
		body: z.object({
			tag_name: releaseTagName,
			target_commitish: z.string().min(1).max(300).optional(),
			previous_tag_name: z
				.string()
				.min(1)
				.max(MAX_RELEASE_TAG_CHARS)
				.optional(),
			configuration_file_path: unsupported,
		}),
		response: releaseNotes,
	},
	"repos/get-latest-release": { params: repoParams, response: release },
	"repos/get-release-by-tag": {
		params: repoParams.extend({ tag: z.string().min(1) }),
		response: release,
	},
	"repos/get-release-asset": { params: assetParams, response: releaseAsset },
	"repos/update-release-asset": {
		params: assetParams,
		body: z.object({
			name: assetName.optional(),
			label: assetLabel.nullish(),
			state: z.enum(["uploaded", "open"]).optional(),
		}),
		response: releaseAsset,
	},
	"repos/delete-release-asset": { params: assetParams, response: noContent },
	"repos/finish-release-asset-upload": {
		params: assetParams,
		response: releaseAsset,
	},
	"repos/get-release": { params: releaseParams, response: release },
	"repos/update-release": {
		params: releaseParams,
		body: z.object({ tag_name: releaseTagName.optional(), ...releaseFields }),
		response: release,
	},
	"repos/delete-release": { params: releaseParams, response: noContent },
	"repos/list-release-assets": {
		params: releaseParams,
		query: pagination,
		response: z.array(releaseAsset),
	},
	"repos/upload-release-asset": {
		params: releaseParams,
		// The request body is the file's raw bytes.
		query: z.object({ name: assetName, label: assetLabel.optional() }),
		response: releaseAsset,
	},
	"repos/create-release-asset-upload": {
		params: releaseParams,
		body: z.object({
			name: assetName,
			label: assetLabel.nullish(),
			content_type: z
				.string()
				.min(1)
				.max(255)
				.default("application/octet-stream"),
			size: z.number().int().positive().max(MAX_RELEASE_ASSET_BYTES),
		}),
		response: releaseAsset.extend({ upload_url: z.string() }),
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
		query: checkRunList.query.extend({ app_id: unsupported }),
		response: checkRunsResponse,
	},
	"checks/list-suites-for-ref": {
		params: refParams,
		query: pagination.extend({ app_id: unsupported, check_name: unsupported }),
		response: z.object({
			total_count: z.number().int().nonnegative(),
			check_suites: z.array(checkSuite),
		}),
	},
	"repos/get-commit": {
		params: repoParams.extend({ ref: z.string().min(1) }),
		query: pagination,
		response: commitDetail,
	},
	"repos/compare-commits": {
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
			signature: unsupported,
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
			/** A milestone number, `*` (any) or `none`. */
			milestone: z
				.union([
					z.literal(["*", "none"]),
					z.string().regex(/^[1-9][0-9]{0,9}$/),
				])
				.optional(),
			sort: z
				.enum(["created", "updated", "comments"])
				.default("created")
				.catch("created"),
			direction: z.enum(["asc", "desc"]).default("desc").catch("desc"),
			/** The author's login. */
			creator: z.string().max(100).optional(),
			/** A login mentioned in the title, body or a comment. */
			mentioned: z.string().max(100).optional(),
			/**
			 * GitHub's issue-type filter. PushStack has no issue types, so `*`
			 * (any) and `none` both match every issue; any other name is `422`.
			 */
			type: z.enum(["*", "none"]).optional(),
			/** Updated at or after this time. */
			since: isoDate.optional(),
			issue_field_values: unsupported,
		}),
		response: z.array(issue),
	},
	"issues/create": {
		params: repoParams,
		body: z.object({
			title: threadTitle,
			body: threadBody.nullish(),
			labels: labelNames.optional(),
			assignee: assigneeLogin.nullish(),
			assignees: assigneeLogins.optional(),
			milestone: milestoneRef.nullish(),
			type: unsupported,
			parent_issue_id: unsupported,
			issue_field_values: unsupported,
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
			assignee: assigneeLogin.nullish(),
			assignees: assigneeLogins.optional(),
			milestone: milestoneRef.nullish(),
			duplicate_issue_id: unsupported,
			issue_field_values: unsupported,
			type: unsupported,
		}),
		response: issue,
	},
	"issues/list-comments": {
		params: issueParams,
		query: pagination.extend({ since: isoDate.optional() }),
		response: z.array(issueComment),
	},
	"issues/create-comment": {
		params: issueParams,
		body: z.object({ body: commentBody }),
		response: issueComment,
	},
	"issues/list-events-for-timeline": {
		params: issueParams,
		query: pagination.extend({ exclude: unsupported }),
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
		query: pagination,
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
			draft: z.boolean().optional(),
			head_repo: unsupported,
			issue: unsupported,
			maintainer_can_modify: unsupported,
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
			maintainer_can_modify: unsupported,
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
			/** `merge`, `squash` or `rebase`; a method the repository disallows is `405`. */
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

	"pulls/list-requested-reviewers": {
		params: pullParams,
		response: requestedReviewers,
	},
	"pulls/request-reviewers": {
		params: pullParams,
		body: z.object({
			reviewers: reviewerLogins.optional(),
			team_reviewers: reviewerLogins.optional(),
		}),
		response: pullRequestSimple,
	},
	"pulls/remove-requested-reviewers": {
		params: pullParams,
		body: z.object({
			reviewers: reviewerLogins,
			team_reviewers: reviewerLogins.optional(),
		}),
		response: pullRequestSimple,
	},
	"issues/list-milestones": {
		params: repoParams,
		query: pagination.extend({
			state: listState,
			sort: z
				.enum(["due_on", "completeness"])
				.default("due_on")
				.catch("due_on"),
			direction: z.enum(["asc", "desc"]).default("asc").catch("asc"),
		}),
		response: z.array(milestone),
	},
	"issues/create-milestone": {
		params: repoParams,
		body: z.object({
			title: milestoneTitle,
			state: z.enum(["open", "closed"]).default("open"),
			description: milestoneDescription.nullish(),
			due_on: milestoneDueOn.nullish(),
		}),
		response: milestone,
	},
	"issues/get-milestone": {
		params: milestoneParams,
		response: milestone,
	},
	"issues/update-milestone": {
		params: milestoneParams,
		body: z.object({
			title: milestoneTitle.optional(),
			state: z.enum(["open", "closed"]).optional(),
			description: milestoneDescription.nullish(),
			due_on: milestoneDueOn.nullish(),
		}),
		response: milestone,
	},
	"issues/delete-milestone": {
		params: milestoneParams,
		response: noContent,
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
			archived: unsupported,
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
