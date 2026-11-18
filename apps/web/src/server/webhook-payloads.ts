/**
 * GitHub's webhook payloads and the `hook` object they carry. A payload's
 * repository matches `GET /repos/{owner}/{repo}`, so a receiver that also
 * calls the API sees one shape.
 */
import { type CommitInfo, DiffLimitError } from "git-fs-s3/ops";
import git from "isomorphic-git";
import { MAX_WEBHOOK_COMMIT_FILES, MAX_WEBHOOK_COMMITS } from "#/lib/limits";
import { apiUrl, htmlUrl, isoTimestamp } from "./api/http";
import { repositoryPayload } from "./api/repos";
import { type Shape, simpleUser } from "./api/serializers";
import { getCommitDiff } from "./git-read";
import { repoFor } from "./git-repo";
import { ownerKeyOf } from "./git-storage-naming";
import type { PublicUser, RepositoryRowWithOwner } from "./repository-lookup";
import type { Webhook, WebhookDeliveryRow } from "./webhook-store";

const PING_ZEN = "Non-blocking is better than blocking.";

export function webhookConfigPayload(hook: Webhook): Shape<"webhookConfig"> {
	return {
		content_type: hook.contentType,
		insecure_ssl: "0",
		secret: hook.secretSealed ? "********" : "",
		url: hook.url,
	};
}

function fullNameOf(repo: RepositoryRowWithOwner): string {
	return `${repo.owner.username}/${repo.name}`;
}

export function webhookPayload(
	repo: RepositoryRowWithOwner,
	hook: Webhook,
): Shape<"webhook"> {
	const base = `/repos/${fullNameOf(repo)}/hooks/${hook.id}`;
	return {
		type: "Repository",
		id: hook.id,
		name: "web",
		active: hook.active,
		events: hook.events,
		config: webhookConfigPayload(hook),
		created_at: isoTimestamp(hook.createdAt),
		updated_at: isoTimestamp(hook.updatedAt),
		url: apiUrl(base),
		test_url: apiUrl(`${base}/test`),
		ping_url: apiUrl(`${base}/pings`),
		deliveries_url: apiUrl(`${base}/deliveries`),
		last_response: {
			code: hook.lastStatusCode,
			status: hook.lastStatus,
			message: hook.lastMessage,
		},
	};
}

/** One recorded delivery, in the list's shape. */
export function webhookDeliveryPayload(
	repo: RepositoryRowWithOwner,
	row: WebhookDeliveryRow,
): Shape<"webhookDelivery"> {
	return {
		id: row.id,
		guid: row.guid,
		delivered_at: isoTimestamp(row.deliveredAt),
		redelivery: row.redelivery,
		duration: row.durationMs,
		status: row.status,
		status_code: row.statusCode,
		event: row.event,
		action: row.action,
		repository_id: repo.id,
		installation_id: null,
		throttled_at: null,
	};
}

/** The single-delivery read: the same object plus its URLs and payloads. */
export function webhookDeliveryDetailPayload(
	repo: RepositoryRowWithOwner,
	hook: Webhook,
	row: WebhookDeliveryRow,
): Shape<"webhookDeliveryDetail"> {
	return {
		...webhookDeliveryPayload(repo, row),
		url: apiUrl(
			`/repos/${fullNameOf(repo)}/hooks/${hook.id}/deliveries/${row.id}`,
		),
		request: { headers: row.requestHeaders, payload: row.requestPayload },
		response: { headers: row.responseHeaders, payload: row.responsePayload },
	};
}

/** The `ping` event, as `POST …/hooks/{hook_id}/pings` sends it. */
export async function pingPayload(
	repo: RepositoryRowWithOwner,
	hook: Webhook,
	sender: PublicUser,
) {
	return {
		zen: PING_ZEN,
		hook_id: hook.id,
		hook: webhookPayload(repo, hook),
		repository: await repositoryPayload(repo, sender.id, { role: "admin" }),
		sender: simpleUser(sender),
	};
}

const ZERO_OID = "0".repeat(40);

interface PushCommitShape {
	id: string;
	tree_id: string;
	message: string;
	timestamp: string;
	url: string;
	author: { name: string; email: string; username: null };
	committer: { name: string; email: string; username: null };
	added: string[];
	removed: string[];
	modified: string[];
}

function gitActor(identity: { name: string; email: string }): {
	name: string;
	email: string;
	username: null;
} {
	// Commits aren't linked to accounts by email (yet), so `username` is null.
	return { name: identity.name, email: identity.email, username: null };
}

/** A commit's changed paths, or empty arrays when its diff is too large. */
async function changedPaths(
	repo: RepositoryRowWithOwner,
	sha: string,
): Promise<Pick<PushCommitShape, "added" | "removed" | "modified">> {
	const empty = { added: [], removed: [], modified: [] };
	let files: Awaited<ReturnType<typeof getCommitDiff>>["files"];
	try {
		files = (await getCommitDiff(ownerKeyOf(repo), repo.name, sha)).files;
	} catch (error) {
		if (error instanceof DiffLimitError) return empty;
		throw error;
	}
	if (files.length > MAX_WEBHOOK_COMMIT_FILES) return empty;
	const paths = {
		added: [] as string[],
		removed: [] as string[],
		modified: [] as string[],
	};
	for (const file of files) {
		paths[
			file.status === "added"
				? "added"
				: file.status === "deleted"
					? "removed"
					: "modified"
		].push(file.path);
	}
	return paths;
}

async function pushCommitShape(
	repo: RepositoryRowWithOwner,
	info: CommitInfo,
): Promise<PushCommitShape> {
	const fullName = fullNameOf(repo);
	return {
		id: info.oid,
		tree_id: info.commit.tree,
		message: info.commit.message,
		timestamp: isoTimestamp(new Date(info.commit.committer.timestamp * 1000)),
		url: apiUrl(`/repos/${fullName}/commits/${info.oid}`),
		author: gitActor(info.commit.author),
		committer: gitActor(info.commit.committer),
		...(await changedPaths(repo, info.oid)),
	};
}

/** A created or deleted ref is never forced; otherwise it is when `before` is no longer an ancestor. */
async function isForced(
	repo: RepositoryRowWithOwner,
	before: string,
	after: string,
): Promise<boolean> {
	try {
		return !(await git.isDescendent({
			...repoFor(ownerKeyOf(repo), repo.name),
			oid: after,
			ancestor: before,
		}));
	} catch {
		// The previous tip is gone (history rewritten), which is exactly a force push.
		return true;
	}
}

export interface PushEventInput {
	ref: string;
	before: string;
	after: string;
	/** The update's new commits, newest first. */
	commits: CommitInfo[];
	pusher: { name: string; email: string } | null;
	sender: PublicUser | null;
}

/** The `push` event for one accepted ref update. */
export async function pushPayload(
	repo: RepositoryRowWithOwner,
	input: PushEventInput,
) {
	const fullName = fullNameOf(repo);
	const created = input.before === ZERO_OID;
	const deleted = input.after === ZERO_OID;
	const commits = await Promise.all(
		input.commits
			.slice(0, MAX_WEBHOOK_COMMITS)
			.map((info) => pushCommitShape(repo, info))
			.reverse(),
	);
	return {
		ref: input.ref,
		before: input.before,
		after: input.after,
		created,
		deleted,
		forced:
			created || deleted
				? false
				: await isForced(repo, input.before, input.after),
		base_ref: null,
		compare: htmlUrl(
			`/${fullName}/compare/${created ? ZERO_OID : input.before}...${input.after}`,
		),
		commits,
		head_commit: deleted ? null : (commits.at(-1) ?? null),
		pusher: input.pusher,
		repository: await repositoryPayload(repo, input.sender?.id ?? null, {
			role: "admin",
		}),
		sender: input.sender ? simpleUser(input.sender) : null,
	};
}
