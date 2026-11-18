/**
 * The repository webhooks settings page's server functions: hook CRUD, the
 * ping and the delivery log with redelivery. They reuse `webhook-store.ts` and
 * `webhook-payloads.ts`, so a hook created here is the same hook the REST API
 * serves, and every entry point checks ownership or admin itself.
 */
import { inputs } from "@pushstack/api-contract";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { user } from "#/db/schema";
import { afterResponse } from "./after-response";
import { bestEffort } from "./best-effort";
import { getRepositoryAccess } from "./repo-access";
import { findRepositoryById, publicUserColumns } from "./repository-lookup";
import { getCurrentUser } from "./session";
import { deliverWebhook } from "./webhook-deliver";
import {
	createWebhook,
	deleteWebhook,
	findWebhook,
	findWebhookDelivery,
	listWebhookDeliveries,
	listWebhooks,
	updateWebhook,
	type Webhook,
} from "./webhook-store";

export interface WebhookSettings {
	id: number;
	url: string;
	contentType: "json" | "form";
	events: string[];
	active: boolean;
	lastResponse: { code: number | null; status: string | null };
}

export interface WebhookDeliverySettings {
	id: number;
	guid: string;
	event: string;
	action: string | null;
	status: "success" | "failure";
	statusCode: number | null;
	duration: number;
	redelivery: boolean;
	deliveredAt: string;
	requestHeaders: Record<string, string>;
	requestPayload: string | null;
	responseHeaders: Record<string, string> | null;
	responsePayload: string | null;
}

const hookId = z.number().int().positive();

/** Owner or admin of `repoId`, with the caller's id for the delivery's sender. */
async function adminOf(repoId: number) {
	const user = await getCurrentUser();
	const access = await getRepositoryAccess(repoId, user.id);
	if (!access || (access.role !== "owner" && access.role !== "admin")) {
		throw new Error("Must have admin rights to Repository.");
	}
	return user;
}

async function hookFor(repoId: number, id: number): Promise<Webhook> {
	const hook = await findWebhook(repoId, id);
	if (!hook) throw new Error("Not Found");
	return hook;
}

function settingsOf(hook: Webhook): WebhookSettings {
	return {
		id: hook.id,
		url: hook.url,
		contentType: hook.contentType,
		events: hook.events,
		active: hook.active,
		lastResponse: { code: hook.lastStatusCode, status: hook.lastStatus },
	};
}

export const listRepoWebhooks = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number().int() }))
	.handler(async ({ data }) => {
		await adminOf(data.repoId);
		return (await listWebhooks(data.repoId)).map(settingsOf);
	});

export const saveRepoWebhook = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number().int(),
			hookId: hookId.nullable(),
			url: inputs.webhookUrl,
			contentType: z.enum(["json", "form"]),
			/** Absent leaves a stored secret; null removes it. */
			secret: inputs.webhookSecret.nullable().optional(),
			events: inputs.webhookEvents,
			active: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		await adminOf(data.repoId);
		if (data.hookId === null) {
			const hook = await createWebhook(data.repoId, {
				url: data.url,
				contentType: data.contentType,
				secret: data.secret || null,
				events: data.events,
				active: data.active,
			});
			return settingsOf(hook);
		}
		const hook = await hookFor(data.repoId, data.hookId);
		const updated = await updateWebhook(hook, {
			url: data.url,
			contentType: data.contentType,
			events: data.events,
			active: data.active,
			...(data.secret !== undefined && { secret: data.secret }),
		});
		return settingsOf(updated);
	});

export const deleteRepoWebhook = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number().int(), hookId }))
	.handler(async ({ data }) => {
		await adminOf(data.repoId);
		await deleteWebhook((await hookFor(data.repoId, data.hookId)).id);
	});

export const pingRepoWebhook = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number().int(), hookId }))
	.handler(async ({ data }) => {
		const caller = await adminOf(data.repoId);
		const hook = await hookFor(data.repoId, data.hookId);
		await afterResponse(() =>
			bestEffort("webhooks", "ping delivery", async () => {
				const { pingPayload } = await import("./webhook-payloads");
				const [repo, [sender]] = await Promise.all([
					findRepositoryById(data.repoId),
					db.select(publicUserColumns).from(user).where(eq(user.id, caller.id)),
				]);
				if (!repo || !sender) throw new Error("Not Found");
				const payload = await pingPayload(repo, hook, sender);
				await deliverWebhook({ hook, event: "ping", action: null, payload });
			}),
		);
	});

export const listRepoWebhookDeliveries = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number().int(),
			hookId,
			cursor: z.number().int().positive().optional(),
			perPage: z.number().int().positive().max(100).optional(),
		}),
	)
	.handler(async ({ data }) => {
		await adminOf(data.repoId);
		await hookFor(data.repoId, data.hookId);
		const page = await listWebhookDeliveries(data.hookId, {
			...(data.cursor !== undefined && { cursor: data.cursor }),
			perPage: data.perPage ?? 30,
		});
		return {
			deliveries: page.rows.map(
				(row): WebhookDeliverySettings => ({
					id: row.id,
					guid: row.guid,
					event: row.event,
					action: row.action,
					status: row.status,
					statusCode: row.statusCode,
					duration: row.durationMs,
					redelivery: row.redelivery,
					deliveredAt: row.deliveredAt.toISOString(),
					requestHeaders: row.requestHeaders,
					requestPayload: row.requestPayload,
					responseHeaders: row.responseHeaders,
					responsePayload: row.responsePayload,
				}),
			),
			nextCursor: page.nextCursor,
		};
	});

export const redeliverRepoWebhookDelivery = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number().int(),
			hookId,
			deliveryId: z.number().int().positive(),
		}),
	)
	.handler(async ({ data }) => {
		await adminOf(data.repoId);
		const hook = await hookFor(data.repoId, data.hookId);
		const delivery = await findWebhookDelivery(hook.id, data.deliveryId);
		if (!delivery) throw new Error("Not Found");
		if (delivery.requestPayload === null) {
			throw new Error(
				"The delivery's payload was not retained and cannot be redelivered.",
			);
		}
		const body = delivery.requestPayload;
		await afterResponse(() =>
			bestEffort("webhooks", "redelivery", () =>
				deliverWebhook({
					hook,
					event: delivery.event,
					action: delivery.action,
					payload: null,
					body,
					redelivery: true,
				}),
			),
		);
	});
