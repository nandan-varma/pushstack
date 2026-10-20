/**
 * GitHub's JSON shapes (snake_case, ISO-8601 timestamps) for what PushStack
 * stores. Fields PushStack has no equivalent for are omitted, never renamed.
 */
import type { CommitInfo } from "git-fs-s3/ops";
import type { PullRequest, Repository } from "#/db/app-schema";
import { getCloneUrl, getGitBaseUrl } from "#/lib/git-utils";
import { DEFAULT_LABELS, type LabelView } from "#/lib/labels";
import type { TimelineEntry } from "#/lib/timeline-types";
import type { PublicUser } from "../repository-lookup";
import type { ThreadKind } from "../thread-store";
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

/** A repository label, GitHub's `Label` shape. */
export function label(
	repo: { fullName: string },
	value: LabelView,
): Record<string, unknown> {
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

/** What the issue serializer needs beyond the stored row. */
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
	/** Only pull requests have one (`null` for issues). */
	mergedAt: Date | null;
	author: PublicUser;
	labels: LabelView[];
	assignees: PublicUser[];
	commentsCount: number;
}

/**
 * GitHub's issue shape. A pull request is returned by the issues endpoints too
 * (GitHub does the same), carrying a `pull_request` object; its web and diff
 * URLs point at the pull request page.
 */
export function issue(input: IssueShapeInput): Record<string, unknown> {
	const { fullName, kind, number } = input;
	const webPath = kind === "issue" ? "issues" : "pulls";
	return {
		id: input.id,
		url: apiUrl(`/repos/${fullName}/issues/${number}`),
		repository_url: apiUrl(`/repos/${fullName}`),
		labels_url: apiUrl(`/repos/${fullName}/issues/${number}/labels{/name}`),
		comments_url: apiUrl(`/repos/${fullName}/issues/${number}/comments`),
		events_url: apiUrl(`/repos/${fullName}/issues/${number}/events`),
		html_url: htmlUrl(`/repo/${fullName}/${webPath}/${number}`),
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
		state_reason: null,
		...(kind === "pull_request" && {
			pull_request: {
				url: apiUrl(`/repos/${fullName}/pulls/${number}`),
				html_url: htmlUrl(`/repo/${fullName}/pulls/${number}`),
				diff_url: htmlUrl(`/repo/${fullName}/pulls/${number}.diff`),
				patch_url: htmlUrl(`/repo/${fullName}/pulls/${number}.patch`),
				merged_at: input.mergedAt ? isoTimestamp(input.mergedAt) : null,
			},
		}),
	};
}

/** What the comment serializer needs. */
export interface CommentShapeInput {
	fullName: string;
	kind: ThreadKind;
	number: number;
	comment: { id: number; body: string; createdAt: Date; updatedAt: Date };
	author: PublicUser;
}

/** GitHub's issue-comment shape (PR comments share it). */
export function issueComment(
	input: CommentShapeInput,
): Record<string, unknown> {
	const { fullName, kind, number } = input;
	const webPath = kind === "issue" ? "issues" : "pulls";
	return {
		id: input.comment.id,
		url: apiUrl(`/repos/${fullName}/issues/comments/${input.comment.id}`),
		html_url: htmlUrl(
			`/repo/${fullName}/${webPath}/${number}#issuecomment-${input.comment.id}`,
		),
		issue_url: apiUrl(`/repos/${fullName}/issues/${number}`),
		user: simpleUser(input.author),
		created_at: isoTimestamp(input.comment.createdAt),
		updated_at: isoTimestamp(input.comment.updatedAt),
		body: input.comment.body,
	};
}

/** A thread a cross-reference points at, serialized once per timeline page. */
export interface TimelineContext {
	fullName: string;
	/** The serialized thread (`issue`) each `#N` names, for `source` objects. */
	threadByNumber: Map<number, unknown>;
}

/**
 * GitHub's timeline event (`IssueEvent`) shape. Fields the stored event has no
 * equivalent for are `null` (or, for an `assigned` event's assignee, a partial
 * user: PushStack records the username and name, not the whole account).
 */
export function timelineEvent(entry: TimelineEntry, ctx: TimelineContext) {
	const commitUrl = (sha: string) =>
		apiUrl(`/repos/${ctx.fullName}/commits/${sha}`);
	const base = {
		id: entry.id,
		url: apiUrl(`/repos/${ctx.fullName}/issues/events/${entry.id}`),
		actor: simpleUser(entry.actor),
		event: entry.event,
		created_at: isoTimestamp(entry.createdAt),
		commit_id: null as string | null,
		commit_url: null as string | null,
		performed_via_github_app: null,
	};
	switch (entry.event) {
		case "closed":
			return {
				...base,
				commit_id: entry.commitSha ?? null,
				commit_url: entry.commitSha ? commitUrl(entry.commitSha) : null,
				state_reason: null,
			};
		case "reopened":
			return { ...base, state_reason: "reopened" };
		case "merged":
			return {
				...base,
				commit_id: entry.commitSha,
				commit_url: commitUrl(entry.commitSha),
				state_reason: null,
			};
		case "referenced":
			return {
				...base,
				commit_id: entry.commitSha,
				commit_url: commitUrl(entry.commitSha),
			};
		case "cross-referenced":
			return {
				...base,
				source: {
					type: entry.source.kind,
					issue: ctx.threadByNumber.get(entry.source.number) ?? null,
				},
			};
		case "head_ref_deleted":
			return base;
		case "renamed":
			return { ...base, rename: { from: entry.from, to: entry.to } };
		case "labeled":
		case "unlabeled":
			return {
				...base,
				label: { name: entry.label.name, color: entry.label.color },
			};
		case "assigned":
		case "unassigned":
			return {
				...base,
				assignee: {
					login: entry.assignee.username,
					name: entry.assignee.name,
					type: "User" as const,
				},
			};
	}
}

type Identity = CommitInfo["commit"]["author"];

/**
 * Web-UI commits are stamped with the account's sign-in email, which must
 * never leave the server, so every identity gets one noreply placeholder.
 */
export const gitIdentity = ({ name, timestamp }: Identity) => ({
	name,
	email: `noreply@${new URL(getGitBaseUrl()).host}`,
	date: isoTimestamp(new Date(timestamp * 1000)),
});

/** GitHub's commit object (as `GET /pulls/{n}/commits` lists it). */
export function commitObject(fullName: string, info: CommitInfo) {
	const { commit, oid } = info;
	const url = apiUrl(`/repos/${fullName}/commits/${oid}`);
	return {
		sha: oid,
		commit: {
			url,
			author: gitIdentity(commit.author),
			committer: gitIdentity(commit.committer),
			message: commit.message,
			tree: {
				sha: commit.tree,
				url: apiUrl(`/repos/${fullName}/git/trees/${commit.tree}`),
			},
			comment_count: 0,
		},
		url,
		html_url: htmlUrl(`/repo/${fullName}/commit/${oid}`),
		comments_url: apiUrl(`/repos/${fullName}/commits/${oid}/comments`),
		// Commits aren't linked to accounts by email (yet).
		author: null,
		committer: null,
		parents: commit.parent.map((sha) => ({
			sha,
			url: apiUrl(`/repos/${fullName}/commits/${sha}`),
			html_url: htmlUrl(`/repo/${fullName}/commit/${sha}`),
		})),
	};
}

/** What the pull request serializer needs beyond the stored row. */
export interface PullShapeInput {
	repo: Repository & { owner: PublicUser };
	/** The repository object both `head.repo` and `base.repo` carry. */
	repoShape: Record<string, unknown>;
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

/** GitHub's pull request shape; the single-resource extras come with `detail`. */
export function pullRequest(input: PullShapeInput): Record<string, unknown> {
	const { repo, row } = input;
	const fullName = `${repo.owner.username}/${repo.name}`;
	const number = row.number;
	const url = apiUrl(`/repos/${fullName}/pulls/${number}`);
	const web = htmlUrl(`/repo/${fullName}/pulls/${number}`);
	const side = (ref: string, sha: string) => ({
		label: `${repo.owner.username}:${ref}`,
		ref,
		sha,
		user: simpleUser(repo.owner),
		repo: input.repoShape,
	});
	const merged = row.status === "merged";
	const closedAt =
		row.status === "open" ? null : (row.mergedAt ?? row.updatedAt);
	const detail = input.detail;
	return {
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
		assignee: null,
		assignees: [],
		requested_reviewers: [],
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
		draft: false,
		...(detail && {
			merged,
			// Conflicts aren't pre-computed: an open pull request's mergeability
			// is "not yet known", which GitHub also reports while it computes.
			mergeable: merged ? false : null,
			rebaseable: false,
			mergeable_state: "unknown",
			merged_by: detail.mergedBy ? simpleUser(detail.mergedBy) : null,
			comments: input.commentsCount,
			review_comments: detail.reviewComments,
			maintainer_can_modify: false,
			commits: detail.commits,
			additions: detail.additions,
			deletions: detail.deletions,
			changed_files: detail.changedFiles,
		}),
	};
}
