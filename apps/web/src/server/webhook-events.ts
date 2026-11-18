/**
 * Webhook fan-out: the payloads of one event to every active hook of a
 * repository that subscribes to it, after the response. Hooks are looked up
 * once per event, so an event nobody subscribes to costs one query and no
 * delivery. A delivery failure is logged and never fails the write that
 * triggered it; GitHub also never retries a failed delivery.
 */
import { and, eq, or, sql } from "drizzle-orm";
import type { RefUpdateCommand, RefUpdateResult } from "git-fs-s3/http";
import { db } from "#/db";
import { webhooks } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_WEBHOOK_COMMITS } from "#/lib/limits";
import { afterResponse } from "./after-response";
import { bestEffort } from "./best-effort";
import { commitsInUpdate } from "./commit-references";
import { ownerKeyOf } from "./git-storage-naming";
import {
	findRepositoryById,
	type PublicUser,
	publicUserColumns,
} from "./repository-lookup";
import { deliverWebhook } from "./webhook-deliver";
import { pushPayload } from "./webhook-payloads";
import type { Webhook } from "./webhook-store";

export type WebhookEventName = "push" | "issues" | "pull_request";

async function hooksListeningTo(
	repoId: number,
	event: WebhookEventName,
): Promise<Webhook[]> {
	return db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.repoId, repoId),
				eq(webhooks.active, true),
				or(
					sql`${webhooks.events} @> ${JSON.stringify([event])}::jsonb`,
					sql`${webhooks.events} @> '["*"]'::jsonb`,
				),
			),
		);
}

export interface WebhookEvent {
	repoId: number;
	event: WebhookEventName;
	action: string | null;
	/** One entry per delivery: a push of several refs is several events. */
	payloads: () => Promise<unknown[]>;
}

/** Deliver `input` to the repository's subscribers, after the response. */
export async function emitWebhookEvent(input: WebhookEvent): Promise<void> {
	await afterResponse(() =>
		bestEffort("webhooks", `The ${input.event} event`, async () => {
			const hooks = await hooksListeningTo(input.repoId, input.event);
			if (hooks.length === 0) return;
			const payloads = await input.payloads();
			await Promise.allSettled(
				hooks.flatMap((hook) =>
					payloads.map((payload) =>
						deliverWebhook({
							hook,
							event: input.event,
							action: input.action,
							payload,
						}),
					),
				),
			);
		}),
	);
}

async function pusherOf(
	userId: string,
): Promise<{ name: string; email: string; user: PublicUser } | null> {
	const [row] = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(eq(user.id, userId));
	return row ? { name: row.name, email: row.email, user: row } : null;
}

export interface PushEventBatch {
	repoId: number;
	defaultBranch: string;
	/** The authenticated pusher, or null for a deploy-style credential. */
	pusherId: string | null;
	updates: RefUpdateCommand[];
	results: RefUpdateResult[];
}

/**
 * One `push` event per accepted branch or tag update, as GitHub sends them
 * (`git push --all` of three branches is three events). A created or deleted
 * ref carries the zero oid on the side that does not exist.
 */
export async function emitPushEvents(batch: PushEventBatch): Promise<void> {
	const accepted = new Set(
		batch.results.filter((result) => result.ok).map((result) => result.refName),
	);
	const updates = batch.updates.filter(
		(update) =>
			accepted.has(update.refName) &&
			(update.refName.startsWith("refs/heads/") ||
				update.refName.startsWith("refs/tags/")),
	);
	if (updates.length === 0) return;
	const repo = await findRepositoryById(batch.repoId);
	if (!repo) return;
	const pusher = batch.pusherId ? await pusherOf(batch.pusherId) : null;
	await emitWebhookEvent({
		repoId: repo.id,
		event: "push",
		action: null,
		payloads: async () => {
			const payloads = [];
			for (const update of updates) {
				payloads.push(
					await pushPayload(repo, {
						ref: update.refName,
						before: update.oldOid,
						after: update.newOid,
						commits: await commitsInUpdate(
							ownerKeyOf(repo),
							repo.name,
							update,
							batch.defaultBranch,
							MAX_WEBHOOK_COMMITS,
						),
						pusher: pusher && { name: pusher.name, email: pusher.email },
						sender: pusher?.user ?? null,
					}),
				);
			}
			return payloads;
		},
	});
}
