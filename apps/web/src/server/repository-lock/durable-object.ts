import { DurableObject } from "cloudflare:workers";
import { type Lease, LeaseQueue } from "./lease-queue";
import { LOCK_LEASE_MS } from "./settings";

const HOLDER_KEY = "holder";

/**
 * One instance per repository (named by `ownerKey/repoName`), so every writer
 * to that repository, on any isolate in any location, queues here. The holder
 * is persisted so an object evicted while a writer is mid-operation still
 * honors its lease; an alarm frees it if the writer never renews or releases.
 */
export class RepositoryLock extends DurableObject<Cloudflare.Env> {
	#queue = new LeaseQueue({ leaseMs: LOCK_LEASE_MS });

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			const restored = await ctx.storage.get<Lease>(HOLDER_KEY);
			this.#queue = new LeaseQueue(
				{ leaseMs: LOCK_LEASE_MS },
				restored ?? null,
			);
		});
	}

	async acquire(timeoutMs: number): Promise<string> {
		const lease = await this.#queue.acquire(timeoutMs);
		await this.#persist();
		return lease.token;
	}

	async renew(token: string): Promise<boolean> {
		const renewed = this.#queue.renew(token);
		await this.#persist();
		return renewed;
	}

	async release(token: string): Promise<void> {
		this.#queue.release(token);
		await this.#persist();
	}

	async alarm(): Promise<void> {
		this.#queue.expire();
		await this.#persist();
	}

	/** Saves the holder and points the alarm at its expiry. */
	async #persist(): Promise<void> {
		const { holder } = this.#queue;
		if (holder === null) {
			await this.ctx.storage.delete(HOLDER_KEY);
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.ctx.storage.put(HOLDER_KEY, holder);
		await this.ctx.storage.setAlarm(holder.expiresAt);
	}
}
