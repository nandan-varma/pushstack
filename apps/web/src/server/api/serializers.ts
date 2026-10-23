/**
 * GitHub's JSON shapes (snake_case, ISO-8601 timestamps) for what PushStack
 * stores. Fields PushStack has no equivalent for are omitted, never renamed.
 */
import type { resources } from "@pushstack/api-contract";
import type { CommitInfo } from "git-fs-s3/ops";
import type { z } from "zod";
import type { Repository } from "#/db/app-schema";
import { getCloneUrl, getGitBaseUrl } from "#/lib/git-utils";
import { DEFAULT_LABELS, type LabelView } from "#/lib/labels";
import { emptyReactionRollup, type ReactionRollup } from "#/lib/reactions";
import type { TimelineEntry } from "#/lib/timeline-types";
import type { ReactionWithUser } from "../reaction-store";
import type { PublicUser } from "../repository-lookup";
import type { PullRequest, ThreadKind } from "../thread-store";
import { apiUrl, encodePath, htmlUrl, isoTimestamp } from "./http";

/** A GitHub resource shape from `@pushstack/api-contract`, as serialized. */
export type Shape<K extends keyof typeof resources> = z.output<
	(typeof resources)[K]
>;

export type RepoRole = "owner" | "admin" | "write" | "read" | "anonymous";

/** GitHub's legacy global id for a user: base64 of `04:User<id>`. */
function userNodeId(apiId: number) {
	return Buffer.from(`04:User${apiId}`).toString("base64");
}

export function simpleUser(user: PublicUser): Shape<"simpleUser"> {
	return {
		login: user.username,
		id: user.apiId,
		node_id: userNodeId(user.apiId),
		avatar_url: user.image,
		url: apiUrl(`/users/${user.username}`),
		html_url: htmlUrl(`/${user.username}`),
		type: "User" as const,
		site_admin: false,
	};
}

export function publicUser(
	user: PublicUser & { createdAt: Date; updatedAt: Date },
	counts: { publicRepos: number; followers: number; following: number },
): Shape<"publicUser"> {
	return {
		...simpleUser(user),
		name: user.name,
		email: null,
		public_repos: counts.publicRepos,
		followers: counts.followers,
		following: counts.following,
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
	options: {
		stars: number;
		openIssues: number;
		role?: RepoRole;
		/** People watching: only the single-repository resource carries it. */
		subscribers?: number;
	},
): Shape<"repository"> {
	const fullName = `${repo.owner.username}/${repo.name}`;
	return {
		id: repo.id,
		name: repo.name,
		full_name: fullName,
		private: repo.visibility === "private",
		owner: simpleUser(repo.owner),
		html_url: htmlUrl(`/${repo.owner.username}/${repo.name}`),
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
		watchers: options.stars,
		...(options.subscribers !== undefined && {
			subscribers_count: options.subscribers,
		}),
		forks_count: 0,
		open_issues_count: options.openIssues,
		...(options.role && { permissions: permissionsFor(options.role) }),
	};
}

export function commitRef(repo: { fullName: string }, sha: string) {
	return { sha, url: apiUrl(`/repos/${repo.fullName}/commits/${sha}`) };
}

export function branchHtmlUrl(fullName: string, branch: string) {
	return htmlUrl(`/${fullName}/tree/${encodePath(branch)}`);
}

export function label(
	repo: { fullName: string },
	value: LabelView,
): Shape<"label"> {
	return {
		id: value.id,
		url: apiUrl(
			`/repos/${repo.fullName}/labels/${encodeURIComponent(value.name)}`,
		),
		name: value.name,
		color: value.color,
		default: DEFAULT_LABELS.some(
			(d) => d.name.toLowerCase() === value.name.toLowerCase(),
		),
		description: value.description,
	};
}

export interface IssueShapeInput {
	fullName: string;
	kind: ThreadKind;
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	createdAt: Date;
	updatedAt: Date;
	closedAt: Date | null;
	stateReason: "completed" | "not_planned" | "reopened" | null;
	/** Single-issue GET only: who closed it (`null` when open or unknown). */
	closedBy?: PublicUser | null;
	/** Only pull requests have one (`null` for issues). */
	mergedAt: Date | null;
	author: PublicUser;
	labels: LabelView[];
	assignees: PublicUser[];
	commentsCount: number;
	reactions: ReactionRollup;
}

/** GitHub's `reactions` rollup; `url` lists the subject's reactions. */
export function reactionRollup(
	url: string,
	counts: ReactionRollup,
): Shape<"reactionRollup"> {
	return {
		url,
		total_count: counts.total_count,
		"+1": counts["+1"],
		"-1": counts["-1"],
		laugh: counts.laugh,
		confused: counts.confused,
		heart: counts.heart,
		hooray: counts.hooray,
		rocket: counts.rocket,
		eyes: counts.eyes,
	};
}

/** GitHub's legacy global id for a reaction: base64 of `08:Reaction<id>`. */
export function reaction(value: ReactionWithUser): Shape<"reaction"> {
	return {
		id: value.id,
		node_id: Buffer.from(`08:Reaction${value.id}`).toString("base64"),
		user: simpleUser(value.user),
		content: value.content,
		created_at: isoTimestamp(value.createdAt),
	};
}

/**
 * GitHub's issue shape. A pull request is returned by the issues endpoints too
 * (GitHub does the same), carrying a `pull_request` object; its web and diff
 * URLs point at the pull request page.
 */
export function issue(input: IssueShapeInput): Shape<"issue"> {
	const { fullName, kind, number } = input;
	const webPath = kind === "issue" ? "issues" : "pull";
	return {
		id: input.id,
		url: apiUrl(`/repos/${fullName}/issues/${number}`),
		repository_url: apiUrl(`/repos/${fullName}`),
		labels_url: apiUrl(`/repos/${fullName}/issues/${number}/labels{/name}`),
		comments_url: apiUrl(`/repos/${fullName}/issues/${number}/comments`),
		events_url: apiUrl(`/repos/${fullName}/issues/${number}/events`),
		html_url: htmlUrl(`/${fullName}/${webPath}/${number}`),
		number,
		state: input.state,
		title: input.title,
		body: input.body,
		user: simpleUser(input.author),
		labels: input.labels.map((value) => label({ fullName }, value)),
		assignees: input.assignees.map(simpleUser),
		assignee: input.assignees[0] ? simpleUser(input.assignees[0]) : null,
		locked: false,
		active_lock_reason: null,
		comments: input.commentsCount,
		milestone: null,
		created_at: isoTimestamp(input.createdAt),
		updated_at: isoTimestamp(input.updatedAt),
		closed_at: input.closedAt ? isoTimestamp(input.closedAt) : null,
		state_reason: input.stateReason,
		reactions: reactionRollup(
			apiUrl(`/repos/${fullName}/issues/${number}/reactions`),
			input.reactions,
		),
		...(input.closedBy !== undefined && {
			closed_by: input.closedBy ? simpleUser(input.closedBy) : null,
		}),
		...(kind === "pull_request" && {
			pull_request: {
				url: apiUrl(`/repos/${fullName}/pulls/${number}`),
				html_url: htmlUrl(`/${fullName}/pull/${number}`),
				diff_url: htmlUrl(`/${fullName}/pull/${number}.diff`),
				patch_url: htmlUrl(`/${fullName}/pull/${number}.patch`),
				merged_at: input.mergedAt ? isoTimestamp(input.mergedAt) : null,
			},
		}),
	};
}

export interface CommentShapeInput {
	fullName: string;
	kind: ThreadKind;
	number: number;
	comment: { id: number; body: string; createdAt: Date; updatedAt: Date };
	author: PublicUser;
	reactions: ReactionRollup;
}

export function issueComment(input: CommentShapeInput): Shape<"issueComment"> {
	const { fullName, kind, number } = input;
	const webPath = kind === "issue" ? "issues" : "pull";
	return {
		id: input.comment.id,
		url: apiUrl(`/repos/${fullName}/issues/comments/${input.comment.id}`),
		html_url: htmlUrl(
			`/${fullName}/${webPath}/${number}#issuecomment-${input.comment.id}`,
		),
		issue_url: apiUrl(`/repos/${fullName}/issues/${number}`),
		user: simpleUser(input.author),
		created_at: isoTimestamp(input.comment.createdAt),
		updated_at: isoTimestamp(input.comment.updatedAt),
		body: input.comment.body,
		reactions: reactionRollup(
			apiUrl(
				`/repos/${fullName}/issues/comments/${input.comment.id}/reactions`,
			),
			input.reactions,
		),
	};
}

export interface CommitCommentShapeInput {
	fullName: string;
	comment: {
		id: number;
		commitSha: string;
		body: string;
		path: string | null;
		position: number | null;
		line: number | null;
		createdAt: Date;
		updatedAt: Date;
	};
	author: PublicUser;
}

export function commitComment(
	input: CommitCommentShapeInput,
): Shape<"commitComment"> {
	const { fullName, comment } = input;
	return {
		id: comment.id,
		url: apiUrl(`/repos/${fullName}/comments/${comment.id}`),
		html_url: htmlUrl(
			`/${fullName}/commit/${comment.commitSha}#commitcomment-${comment.id}`,
		),
		body: comment.body,
		path: comment.path,
		position: comment.position,
		line: comment.line,
		commit_id: comment.commitSha,
		user: simpleUser(input.author),
		created_at: isoTimestamp(comment.createdAt),
		updated_at: isoTimestamp(comment.updatedAt),
		reactions: reactionRollup(
			apiUrl(`/repos/${fullName}/comments/${comment.id}/reactions`),
			emptyReactionRollup(),
		),
	};
}

/** A thread a cross-reference points at, serialized once per timeline page. */
export interface TimelineContext {
	fullName: string;
	/** The serialized thread (`issue`) each `#N` names, for `source` objects. */
	threadByNumber: Map<number, Shape<"issue">>;
	/** Users named by `review_requested` events, by lower-cased username. */
	reviewers: Map<string, PublicUser>;
}

/**
 * GitHub's timeline event (`IssueEvent`) shape. Fields the stored event has no
 * equivalent for are `null` (or, for an `assigned` event's assignee, a partial
 * user: PushStack records the username and name, not the whole account).
 * `reviewed` has no issue-event shape: the timeline serves it as its own
 * item ({@link reviewedItem}), so here it is `null`.
 */
export function timelineEvent(
	entry: TimelineEntry,
	ctx: TimelineContext,
): Shape<"issueEvent"> | null {
	const commitUrl = (sha: string) =>
		apiUrl(`/repos/${ctx.fullName}/commits/${sha}`);
	const base = {
		id: entry.id,
		url: apiUrl(`/repos/${ctx.fullName}/issues/events/${entry.id}`),
		actor: simpleUser(entry.actor),
		created_at: isoTimestamp(entry.createdAt),
		commit_id: null as string | null,
		commit_url: null as string | null,
		performed_via_github_app: null,
	};
	switch (entry.event) {
		case "closed":
			return {
				...base,
				event: entry.event,
				commit_id: entry.commitSha ?? null,
				commit_url: entry.commitSha ? commitUrl(entry.commitSha) : null,
				state_reason: entry.stateReason ?? "completed",
			};
		case "reopened":
			return { ...base, event: entry.event, state_reason: "reopened" };
		case "merged":
			return {
				...base,
				event: entry.event,
				commit_id: entry.commitSha,
				commit_url: commitUrl(entry.commitSha),
				state_reason: null,
			};
		case "referenced":
			return {
				...base,
				event: entry.event,
				commit_id: entry.commitSha,
				commit_url: commitUrl(entry.commitSha),
			};
		case "cross-referenced":
			return {
				...base,
				event: entry.event,
				source: {
					type: entry.source.kind,
					issue: ctx.threadByNumber.get(entry.source.number) ?? null,
				},
			};
		case "head_ref_deleted":
		case "ready_for_review":
		case "convert_to_draft":
			return { ...base, event: entry.event };
		case "renamed":
			return {
				...base,
				event: entry.event,
				rename: { from: entry.from, to: entry.to },
			};
		case "labeled":
		case "unlabeled":
			return {
				...base,
				event: entry.event,
				label: { name: entry.label.name, color: entry.label.color },
			};
		case "assigned":
		case "unassigned":
			return {
				...base,
				event: entry.event,
				assignee: {
					login: entry.assignee.username,
					name: entry.assignee.name,
					type: "User" as const,
				},
			};
		case "review_requested":
		case "review_request_removed": {
			const reviewer = ctx.reviewers.get(entry.reviewer.username.toLowerCase());
			if (!reviewer) return null;
			return {
				...base,
				event: entry.event,
				review_requester: simpleUser(entry.actor),
				requested_reviewer: simpleUser(reviewer),
			};
		}
		case "reviewed":
			return null;
	}
}

type Identity = CommitInfo["commit"]["author"];

/**
 * Web-UI commits are stamped with the account's sign-in email, which must
 * never leave the server, so every identity gets one noreply placeholder.
 */
export const gitIdentity = ({
	name,
	timestamp,
}: Identity): Shape<"gitIdentity"> => ({
	name,
	email: `noreply@${new URL(getGitBaseUrl()).host}`,
	date: isoTimestamp(new Date(timestamp * 1000)),
});

/**
 * `commentCount` is the commit's commit-comment count (`comment_count`);
 * callers look counts up with `commit-comment-store.ts`'s
 * `commitCommentCounts`.
 */
export function commitObject(
	fullName: string,
	info: CommitInfo,
	commentCount = 0,
): Shape<"commit"> {
	const { commit, oid } = info;
	const url = apiUrl(`/repos/${fullName}/commits/${oid}`);
	return {
		sha: oid,
		commit: {
			url,
			author: gitIdentity(commit.author),
			committer: gitIdentity(commit.committer),
			message: commitMessage(commit.message),
			tree: {
				sha: commit.tree,
				url: apiUrl(`/repos/${fullName}/git/trees/${commit.tree}`),
			},
			comment_count: commentCount,
		},
		url,
		html_url: htmlUrl(`/${fullName}/commit/${oid}`),
		comments_url: apiUrl(`/repos/${fullName}/commits/${oid}/comments`),
		// Commits aren't linked to accounts by email (yet).
		author: null,
		committer: null,
		parents: commit.parent.map((sha) => ({
			sha,
			url: apiUrl(`/repos/${fullName}/commits/${sha}`),
			html_url: htmlUrl(`/${fullName}/commit/${sha}`),
		})),
	};
}

export interface PullShapeInput {
	assignees: PublicUser[];
	requestedReviewers: PublicUser[];
	repo: Repository & { owner: PublicUser };
	repoShape: Shape<"repository">;
	row: PullRequest;
	author: PublicUser;
	labels: LabelView[];
	commentsCount: number;
	headSha: string;
	baseSha: string;
	/** Present on a single pull request (GitHub omits these from lists). */
	detail?: {
		mergedBy: PublicUser | null;
		reviewComments: number;
		commits: number;
		additions: number;
		deletions: number;
		changedFiles: number;
	};
}

export function pullRequest(
	input: PullShapeInput,
): Shape<"pullRequestSimple"> | Shape<"pullRequest"> {
	const { repo, row } = input;
	const fullName = `${repo.owner.username}/${repo.name}`;
	const number = row.number;
	const url = apiUrl(`/repos/${fullName}/pulls/${number}`);
	const web = htmlUrl(`/${fullName}/pull/${number}`);
	const side = (ref: string, sha: string) => ({
		label: `${repo.owner.username}:${ref}`,
		ref,
		sha,
		user: simpleUser(repo.owner),
		repo: input.repoShape,
	});
	const merged = row.status === "merged";
	const closedAt =
		row.status === "open"
			? null
			: (row.closedAt ?? row.mergedAt ?? row.updatedAt);
	const detail = input.detail;
	const simple: Shape<"pullRequestSimple"> = {
		url,
		id: row.id,
		html_url: web,
		diff_url: `${web}.diff`,
		patch_url: `${web}.patch`,
		issue_url: apiUrl(`/repos/${fullName}/issues/${number}`),
		commits_url: `${url}/commits`,
		review_comments_url: `${url}/comments`,
		review_comment_url: apiUrl(`/repos/${fullName}/pulls/comments{/number}`),
		comments_url: apiUrl(`/repos/${fullName}/issues/${number}/comments`),
		statuses_url: apiUrl(`/repos/${fullName}/statuses/${input.headSha}`),
		number,
		state: row.status === "open" ? "open" : "closed",
		locked: false,
		title: row.title,
		user: simpleUser(input.author),
		body: row.body,
		labels: input.labels.map((value) => label({ fullName }, value)),
		milestone: null,
		active_lock_reason: null,
		created_at: isoTimestamp(row.createdAt),
		updated_at: isoTimestamp(row.updatedAt),
		closed_at: closedAt ? isoTimestamp(closedAt) : null,
		merged_at: row.mergedAt ? isoTimestamp(row.mergedAt) : null,
		merge_commit_sha: row.mergeCommitSha,
		assignee: input.assignees[0] ? simpleUser(input.assignees[0]) : null,
		assignees: input.assignees.map(simpleUser),
		requested_reviewers: input.requestedReviewers.map(simpleUser),
		requested_teams: [],
		head: side(row.sourceBranch, input.headSha),
		base: side(row.targetBranch, input.baseSha),
		_links: {
			self: { href: url },
			html: { href: web },
			issue: { href: apiUrl(`/repos/${fullName}/issues/${number}`) },
			comments: {
				href: apiUrl(`/repos/${fullName}/issues/${number}/comments`),
			},
			review_comments: { href: `${url}/comments` },
			review_comment: {
				href: apiUrl(`/repos/${fullName}/pulls/comments{/number}`),
			},
			commits: { href: `${url}/commits` },
			statuses: {
				href: apiUrl(`/repos/${fullName}/statuses/${input.headSha}`),
			},
		},
		auto_merge: null,
		draft: row.isDraft,
	};
	if (!detail) return simple;
	return {
		...simple,
		merged,
		// Conflicts aren't pre-computed: an open pull request's mergeability
		// is "not yet known", which GitHub also reports while it computes.
		mergeable: merged ? false : null,
		rebaseable: false,
		mergeable_state: row.isDraft ? "draft" : "unknown",
		merged_by: detail.mergedBy ? simpleUser(detail.mergedBy) : null,
		comments: input.commentsCount,
		review_comments: detail.reviewComments,
		maintainer_can_modify: false,
		commits: detail.commits,
		additions: detail.additions,
		deletions: detail.deletions,
		changed_files: detail.changedFiles,
	};
}

/** A submitted review as GitHub's `reviewed` timeline item. */
export function reviewedItem(input: {
	fullName: string;
	number: number;
	review: {
		id: number;
		state: string;
		body: string | null;
		commitSha: string | null;
		submittedAt: Date | null;
		author: PublicUser;
	};
	association: Shape<"reviewedItem">["author_association"];
}): Shape<"reviewedItem"> {
	const { fullName, number, review } = input;
	if (review.state === "pending" || !review.submittedAt) {
		throw new Error(`Review ${review.id} is not submitted`);
	}
	const html = htmlUrl(
		`/${fullName}/pull/${number}#pullrequestreview-${review.id}`,
	);
	const pullRequestUrl = apiUrl(`/repos/${fullName}/pulls/${number}`);
	return {
		event: "reviewed",
		id: review.id,
		user: simpleUser(review.author),
		body: review.body,
		state: review.state as Shape<"reviewedItem">["state"],
		html_url: html,
		pull_request_url: pullRequestUrl,
		author_association: input.association,
		_links: { html: { href: html }, pull_request: { href: pullRequestUrl } },
		submitted_at: isoTimestamp(review.submittedAt),
		commit_id: review.commitSha,
	};
}

/** A commit message as GitHub serves it: without git's trailing newline. */
export function commitMessage(raw: string): string {
	return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}
