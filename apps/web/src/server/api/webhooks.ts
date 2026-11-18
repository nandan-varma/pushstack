/**
 * GitHub's repository webhooks at `/api/v3`: hook CRUD and the config
 * sub-resource. Reading a repository the caller can't see is a 404; a
 * collaborator without admin is a 403 ("Must have admin rights to
 * Repository."), as on GitHub. Nothing here returns or logs a stored secret.
 */
import { MAX_HOOKS_PER_EVENT, MAX_WEBHOOK_EVENTS } from "#/lib/limits";
import {
	createWebhook,
	deleteWebhook,
	findWebhook,
	listWebhooks,
	TooManyWebhookEventsError,
	updateWebhook,
	type Webhook,
	WebhookEventLimitError,
} from "../webhook-store";
import { type ApiContext, requireScope } from "./auth";
import {
	apiUrl,
	forbiddenError,
	isoTimestamp,
	json,
	noContent,
	notFoundError,
	pagedList,
	validationFailedError,
} from "./http";
import { pathParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import type { Shape } from "./serializers";

type Repo = Awaited<ReturnType<typeof readableRepository>>["repo"];

const fullNameOf = (repo: Repo) => `${repo.owner.username}/${repo.name}`;

/**
 * The repository a hook operation acts on. Hooks are owner/admin only, but a
 * repository the caller can't read stays a 404 (private repositories never
 * reveal that they exist).
 */
async function adminRepository(ctx: ApiContext): Promise<Repo> {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (access.role !== "owner" && access.role !== "admin") {
		throw forbiddenError("Must have admin rights to Repository.");
	}
	return repo;
}

/** The operations whose path names one hook (`…/hooks/{hook_id}`). */
type HookOperation =
	| "repos/get-webhook"
	| "repos/update-webhook"
	| "repos/delete-webhook"
	| "repos/get-webhook-config-for-repo"
	| "repos/update-webhook-config-for-repo";

/** The repository and the hook named by the path; 404 when either is absent. */
async function hookFor(
	ctx: ApiContext,
	id: HookOperation,
): Promise<{ repo: Repo; hook: Webhook }> {
	const repo = await adminRepository(ctx);
	const { hook_id } = pathParams(ctx, id);
	const hook = await findWebhook(repo.id, hook_id);
	if (!hook) throw notFoundError();
	return { repo, hook };
}

function webhookConfigPayload(hook: Webhook): Shape<"webhookConfig"> {
	return {
		content_type: hook.contentType,
		insecure_ssl: "0",
		secret: hook.secretSealed ? "********" : "",
		url: hook.url,
	};
}

function webhookPayload(repo: Repo, hook: Webhook): Shape<"webhook"> {
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

/** One 422 error per event type that already has its 20 hooks. */
function eventLimitErrors(events: string[]) {
	return events.map((event) => ({
		resource: "Hook",
		field: "events",
		code: "custom" as const,
		message: `Only ${MAX_HOOKS_PER_EVENT} webhooks per event type are allowed (${event}).`,
	}));
}

function tooManyEventsError() {
	return validationFailedError("Validation Failed", [
		{
			resource: "Hook",
			field: "events",
			code: "custom",
			message: `A hook may subscribe to at most ${MAX_WEBHOOK_EVENTS} events.`,
		},
	]);
}

/** Runs a hook write, translating the store's event caps into GitHub's 422. */
async function mappingHookCaps<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (error instanceof WebhookEventLimitError) {
			throw validationFailedError(
				"Validation Failed",
				eventLimitErrors(error.events),
			);
		}
		if (error instanceof TooManyWebhookEventsError) throw tooManyEventsError();
		throw error;
	}
}

/** `events`, then `add_events` added, then `remove_events` removed, as GitHub merges them. */
function mergeEvents(
	current: string[],
	body: {
		events?: string[];
		add_events?: string[];
		remove_events?: string[];
	},
): string[] {
	const merged = [...(body.events ?? current)];
	for (const event of body.add_events ?? []) {
		if (!merged.includes(event)) merged.push(event);
	}
	const removed = new Set(body.remove_events);
	return merged.filter((event) => !removed.has(event));
}

export async function listRepoWebhooks(ctx: ApiContext) {
	const repo = await adminRepository(ctx);
	const hooks = await listWebhooks(repo.id);
	return pagedList(ctx.url, hooks, (hook) => webhookPayload(repo, hook));
}

export async function createRepoWebhook(ctx: ApiContext) {
	const repo = await adminRepository(ctx);
	const body = await requestBody(ctx, "repos/create-webhook", "Hook");
	const hook = await mappingHookCaps(() =>
		createWebhook(repo.id, {
			url: body.config.url,
			contentType: body.config.content_type ?? "form",
			secret: body.config.secret || null,
			events: body.events ?? ["push"],
			active: body.active ?? true,
		}),
	);
	return json(webhookPayload(repo, hook), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/hooks/${hook.id}`),
	});
}

export async function getRepoWebhook(ctx: ApiContext) {
	const { repo, hook } = await hookFor(ctx, "repos/get-webhook");
	return json(webhookPayload(repo, hook));
}

export async function updateRepoWebhook(ctx: ApiContext) {
	const { repo, hook } = await hookFor(ctx, "repos/update-webhook");
	const body = await requestBody(ctx, "repos/update-webhook", "Hook", {
		allowEmpty: true,
	});
	const events = mergeEvents(hook.events, body);
	const config = body.config;
	const changesEvents =
		body.events !== undefined ||
		body.add_events !== undefined ||
		body.remove_events !== undefined;
	const updated = await mappingHookCaps(() =>
		updateWebhook(hook, {
			...(changesEvents && { events }),
			...(body.active !== undefined && { active: body.active }),
			...(config?.url !== undefined && { url: config.url }),
			...(config?.content_type !== undefined && {
				contentType: config.content_type,
			}),
			// GitHub's rule: a config without a secret clears the stored one.
			...(config && { secret: config.secret || null }),
		}),
	);
	return json(webhookPayload(repo, updated));
}

export async function deleteRepoWebhook(ctx: ApiContext) {
	const { hook } = await hookFor(ctx, "repos/delete-webhook");
	await deleteWebhook(hook.id);
	return noContent();
}

export async function getRepoWebhookConfig(ctx: ApiContext) {
	const { hook } = await hookFor(ctx, "repos/get-webhook-config-for-repo");
	return json(webhookConfigPayload(hook));
}

export async function updateRepoWebhookConfig(ctx: ApiContext) {
	const { hook } = await hookFor(ctx, "repos/update-webhook-config-for-repo");
	const body = await requestBody(
		ctx,
		"repos/update-webhook-config-for-repo",
		"Hook",
		{ allowEmpty: true },
	);
	const updated = await updateWebhook(hook, {
		...(body.url !== undefined && { url: body.url }),
		...(body.content_type !== undefined && {
			contentType: body.content_type,
		}),
		secret: body.secret || null,
	});
	return json(webhookConfigPayload(updated));
}
