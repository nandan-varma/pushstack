/**
 * GitHub's webhook payloads and the `hook` object they carry. A payload's
 * repository matches `GET /repos/{owner}/{repo}`, so a receiver that also
 * calls the API sees one shape.
 */
import { apiUrl, isoTimestamp } from "./api/http";
import { repositoryPayload } from "./api/repos";
import { type Shape, simpleUser } from "./api/serializers";
import type { PublicUser, RepositoryRowWithOwner } from "./repository-lookup";
import type { Webhook } from "./webhook-store";

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
