/**
 * Webhook fan-out: the payloads of one event to every active hook of a
 * repository that subscribes to it, after the response. Hooks are looked up
 * once per event, so an event nobody subscribes to costs one query and no
 * delivery. The payload builders load lazily because they pull the REST
 * serializers, which such an event never needs. A delivery failure is logged
 * and never fails the write that triggered it; GitHub also never retries a
 * failed delivery.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { RefUpdateCommand, RefUpdateResult } from "git-fs-s3/http";
import { db } from "#/db";
import { issues, pullRequests, webhooks } from "#/db/app-schema";
import { user } from "#/db/schema";
import type { LabelView } from "#/lib/labels";
import {
	MAX_WEBHOOK_COMMITS,
	MAX_WEBHOOK_PR_SYNCHRONIZATIONS,
} from "#/lib/limits";
import { afterResponse } from "./after-response";
import { bestEffort } from "./best-effort";
import { commitsInUpdate } from "./commit-references";
import { ownerKeyOf } from "./git-storage-naming";
import {
	findRepositoryById,
	type PublicUser,
	publicUserColumns,
} from "./repository-lookup";
import { findThread, findThreadById } from "./thread-store";
import { deliverWebhook } from "./webhook-deliver";
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
			const { pushPayload } = await import("./webhook-payloads");
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

async function userById(userId: string): Promise<PublicUser | null> {
	const [row] = await db
		.select(publicUserColumns)
		.from(user)
		.where(eq(user.id, userId));
	return row ?? null;
}

export interface PullRequestEvent {
	repoId: number;
	number: number;
	action:
		| "opened"
		| "reopened"
		| "closed"
		| "synchronize"
		| "edited"
		| "ready_for_review"
		| "converted_to_draft"
		| "labeled"
		| "unlabeled";
	senderId: string;
	changes?: Record<string, unknown>;
	label?: LabelView;
}

/** One `pull_request` event for the thread `number`, after the response. */
export async function emitPullRequestEvent(
	input: PullRequestEvent,
): Promise<void> {
	await emitWebhookEvent({
		repoId: input.repoId,
		event: "pull_request",
		action: input.action,
		payloads: async () => {
			const { pullRequestPayload } = await import("./webhook-payloads");
			const [repo, thread, sender] = await Promise.all([
				findRepositoryById(input.repoId),
				findThread(input.repoId, input.number, "pull_request"),
				userById(input.senderId),
			]);
			if (!repo || !thread || !sender) return [];
			return [
				await pullRequestPayload(repo, {
					action: input.action,
					thread,
					sender,
					...(input.changes && { changes: input.changes }),
					...(input.label !== undefined && { label: input.label }),
				}),
			];
		},
	});
}

/**
 * `synchronize` for every open pull request headed by a branch this push
 * updated, bounded by {@link MAX_WEBHOOK_PR_SYNCHRONIZATIONS} in one query.
 */
export async function emitPullRequestSynchronizations(
	batch: PushEventBatch,
): Promise<void> {
	const branches = batch.updates
		.filter((update) =>
			batch.results.some(
				(result) => result.ok && result.refName === update.refName,
			),
		)
		.filter((update) => update.refName.startsWith("refs/heads/"))
		.map((update) => update.refName.slice("refs/heads/".length));
	if (branches.length === 0) return;
	const heads = await db
		.select({ number: issues.number })
		.from(issues)
		.innerJoin(pullRequests, eq(pullRequests.issueId, issues.id))
		.where(
			and(
				eq(issues.repoId, batch.repoId),
				eq(issues.status, "open"),
				inArray(pullRequests.sourceBranch, branches),
			),
		)
		.limit(MAX_WEBHOOK_PR_SYNCHRONIZATIONS);
	if (heads.length === 0) return;
	const sender = batch.pusherId ? await userById(batch.pusherId) : null;
	if (!sender) return;
	await emitWebhookEvent({
		repoId: batch.repoId,
		event: "pull_request",
		action: "synchronize",
		payloads: async () => {
			const { pullRequestPayload } = await import("./webhook-payloads");
			const repo = await findRepositoryById(batch.repoId);
			if (!repo) return [];
			const payloads = [];
			for (const { number } of heads) {
				const thread = await findThread(batch.repoId, number, "pull_request");
				if (!thread) continue;
				payloads.push(
					await pullRequestPayload(repo, {
						action: "synchronize",
						thread,
						sender,
					}),
				);
			}
			return payloads;
		},
	});
}

export interface IssueEvent {
	repoId: number;
	number: number;
	action: "opened" | "edited" | "closed" | "reopened";
	senderId: string;
	changes?: Record<string, unknown>;
}

/** One `issues` event for `number`, after the response. */
export async function emitIssueEvent(input: IssueEvent): Promise<void> {
	await emitWebhookEvent({
		repoId: input.repoId,
		event: "issues",
		action: input.action,
		payloads: async () => {
			const { issuePayload } = await import("./webhook-payloads");
			const [repo, thread, sender] = await Promise.all([
				findRepositoryById(input.repoId),
				findThread(input.repoId, input.number, "issue"),
				userById(input.senderId),
			]);
			if (!repo || !thread || !sender) return [];
			return [
				await issuePayload(repo, {
					action: input.action,
					thread,
					sender,
					...(input.changes && { changes: input.changes }),
				}),
			];
		},
	});
}

/** A thread's `labeled`/`unlabeled` (or assigned/unassigned) event, by kind. */
async function emitThreadUpdateEvent(
	issueId: number,
	input: {
		action: string;
		senderId: string;
		label?: LabelView;
		assignee?: PublicUser;
	},
): Promise<void> {
	const ref = await findThreadById(issueId);
	if (!ref) return;
	if (ref.kind === "pull_request") {
		await emitPullRequestEvent({
			repoId: ref.repoId,
			number: ref.number,
			action: input.action as PullRequestEvent["action"],
			senderId: input.senderId,
			...(input.label && { label: input.label }),
		});
		return;
	}
	await emitWebhookEvent({
		repoId: ref.repoId,
		event: "issues",
		action: input.action,
		payloads: async () => {
			const { issuePayload } = await import("./webhook-payloads");
			const [repo, thread, sender] = await Promise.all([
				findRepositoryById(ref.repoId),
				findThread(ref.repoId, ref.number, "issue"),
				userById(input.senderId),
			]);
			if (!repo || !thread || !sender) return [];
			return [
				await issuePayload(repo, {
					action: input.action,
					thread,
					sender,
					...(input.label && { label: input.label }),
					...(input.assignee && { assignee: input.assignee }),
				}),
			];
		},
	});
}

export function emitThreadLabelEvent(input: {
	issueId: number;
	action: "labeled" | "unlabeled";
	label: LabelView;
	senderId: string;
}): Promise<void> {
	return emitThreadUpdateEvent(input.issueId, {
		action: input.action,
		senderId: input.senderId,
		label: input.label,
	});
}

export function emitThreadAssigneeEvent(input: {
	issueId: number;
	action: "assigned" | "unassigned";
	assignee: PublicUser;
	senderId: string;
}): Promise<void> {
	return emitThreadUpdateEvent(input.issueId, {
		action: input.action,
		senderId: input.senderId,
		assignee: input.assignee,
	});
}
