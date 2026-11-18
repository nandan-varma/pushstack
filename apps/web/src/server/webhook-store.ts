/**
 * Repository webhooks: CRUD over the `webhooks` table, with GitHub's cap of 20
 * hooks per event type in a repository. A secret is sealed here before it can
 * reach the database, so no caller of this module stores one in the clear.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "#/db";
import { webhooks } from "#/db/app-schema";
import { MAX_HOOKS_PER_EVENT, MAX_WEBHOOK_EVENTS } from "#/lib/limits";
import { withRepositoryCapacityLock } from "./repository-capacity";
import { sealWebhookSecret } from "./webhook-secret";

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookContentType = Webhook["contentType"];

/** More hooks already subscribe to an event type than GitHub allows. */
export class WebhookEventLimitError extends Error {
	constructor(readonly events: string[]) {
		super(
			`Only ${MAX_HOOKS_PER_EVENT} webhooks per event type are allowed: ${events.join(", ")}`,
		);
	}
}

/** A hook's `events` subscribe to more than {@link MAX_WEBHOOK_EVENTS} names. */
export class TooManyWebhookEventsError extends Error {
	constructor() {
		super(`A hook may subscribe to at most ${MAX_WEBHOOK_EVENTS} events`);
	}
}

export async function listWebhooks(repoId: number): Promise<Webhook[]> {
	return db
		.select()
		.from(webhooks)
		.where(eq(webhooks.repoId, repoId))
		.orderBy(asc(webhooks.id));
}

export async function findWebhook(
	repoId: number,
	hookId: number,
): Promise<Webhook | null> {
	const [row] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.repoId, repoId), eq(webhooks.id, hookId)));
	return row ?? null;
}

export interface WebhookInput {
	url: string;
	contentType: WebhookContentType;
	/** Plaintext, or null for a hook without a secret; sealed before storage. */
	secret: string | null;
	events: string[];
	active: boolean;
}

export async function createWebhook(
	repoId: number,
	input: WebhookInput,
): Promise<Webhook> {
	assertEventCount(input.events);
	return withRepositoryCapacityLock(repoId, async () => {
		await assertEventCapacity(repoId, input.events, null);
		const [row] = await db
			.insert(webhooks)
			.values({
				repoId,
				url: input.url,
				contentType: input.contentType,
				secretSealed: input.secret ? sealWebhookSecret(input.secret) : null,
				events: input.events,
				active: input.active,
			})
			.returning();
		if (!row) throw new Error("Webhook insert returned no row");
		return row;
	});
}

export interface WebhookPatch {
	url?: string;
	contentType?: WebhookContentType;
	/** null clears the stored secret; undefined leaves it. */
	secret?: string | null;
	events?: string[];
	active?: boolean;
}

export async function updateWebhook(
	hook: Webhook,
	patch: WebhookPatch,
): Promise<Webhook> {
	if (patch.events) assertEventCount(patch.events);
	const write = () => updateWebhookRow(hook, patch);
	// A patch that changes events has to re-check the per-event cap under the
	// capacity lock, like a create.
	if (!patch.events) return write();
	return withRepositoryCapacityLock(hook.repoId, async () => {
		await assertEventCapacity(hook.repoId, patch.events ?? [], hook.id);
		return write();
	});
}

async function updateWebhookRow(
	hook: Webhook,
	patch: WebhookPatch,
): Promise<Webhook> {
	const [row] = await db
		.update(webhooks)
		.set({
			...(patch.url !== undefined && { url: patch.url }),
			...(patch.contentType !== undefined && {
				contentType: patch.contentType,
			}),
			...(patch.secret !== undefined && {
				secretSealed: patch.secret ? sealWebhookSecret(patch.secret) : null,
			}),
			...(patch.events !== undefined && { events: patch.events }),
			...(patch.active !== undefined && { active: patch.active }),
			updatedAt: new Date(),
		})
		.where(eq(webhooks.id, hook.id))
		.returning();
	if (!row) throw new Error("Webhook update returned no row");
	return row;
}

export async function deleteWebhook(hookId: number): Promise<void> {
	await db.delete(webhooks).where(eq(webhooks.id, hookId));
}

function assertEventCount(events: string[]): void {
	if (events.length > MAX_WEBHOOK_EVENTS) throw new TooManyWebhookEventsError();
}

/**
 * GitHub's per-event cap: at most {@link MAX_HOOKS_PER_EVENT} hooks in a
 * repository may subscribe to one event type. `excludeId` is the hook being
 * updated, which does not count against itself.
 */
async function assertEventCapacity(
	repoId: number,
	events: string[],
	excludeId: number | null,
): Promise<void> {
	const rows = await db
		.select({ id: webhooks.id, events: webhooks.events })
		.from(webhooks)
		.where(eq(webhooks.repoId, repoId));
	const taken = new Map<string, number>();
	for (const row of rows) {
		if (row.id === excludeId) continue;
		for (const event of row.events) {
			taken.set(event, (taken.get(event) ?? 0) + 1);
		}
	}
	const full = [...new Set(events)].filter(
		(event) => (taken.get(event) ?? 0) >= MAX_HOOKS_PER_EVENT,
	);
	if (full.length > 0) throw new WebhookEventLimitError(full);
}
