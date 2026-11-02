/**
 * A FIFO lease: one holder at a time, waiters queued in arrival order, and a
 * lease that lapses unless its holder keeps renewing it (so a crashed writer
 * cannot wedge a repository). Pure logic with an injected clock; the Durable
 * Object (durable-object.ts) persists and schedules it, tests drive it directly.
 */

export interface Lease {
	token: string;
	/** Epoch milliseconds after which the lease may be taken over. */
	expiresAt: number;
}

export interface LeaseQueueOptions {
	leaseMs: number;
	now?: () => number;
	newToken?: () => string;
}

export class LockTimeoutError extends Error {
	constructor(waitedMs: number) {
		super(`Timed out after ${waitedMs} ms waiting for the repository lock`);
		this.name = "LockTimeoutError";
	}
}

interface Waiter {
	grant(lease: Lease): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export class LeaseQueue {
	readonly #leaseMs: number;
	readonly #now: () => number;
	readonly #newToken: () => string;
	readonly #waiters: Waiter[] = [];
	#holder: Lease | null;

	constructor(options: LeaseQueueOptions, restored: Lease | null = null) {
		this.#leaseMs = options.leaseMs;
		this.#now = options.now ?? Date.now;
		this.#newToken = options.newToken ?? (() => crypto.randomUUID());
		this.#holder = restored;
	}

	/** The current lease, or null when the lock is free. */
	get holder(): Lease | null {
		return this.#holder;
	}

	/** Resolves with the lease once it is this caller's turn. */
	acquire(timeoutMs: number): Promise<Lease> {
		this.expire();
		if (this.#holder === null && this.#waiters.length === 0) {
			return Promise.resolve(this.#take());
		}
		return new Promise<Lease>((grant, reject) => {
			const waiter: Waiter = {
				grant,
				reject,
				timer: setTimeout(() => {
					this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
					reject(new LockTimeoutError(timeoutMs));
				}, timeoutMs),
			};
			this.#waiters.push(waiter);
		});
	}

	/** Extends the lease; false when it lapsed or the token is not the holder's. */
	renew(token: string): boolean {
		if (!this.#holds(token)) return false;
		this.#holder = { token, expiresAt: this.#now() + this.#leaseMs };
		return true;
	}

	/** Gives the lock up; a stale token releases nothing. */
	release(token: string): void {
		if (this.#holder?.token !== token) return;
		this.#holder = null;
		this.#handOver();
	}

	/** Frees a lapsed lease and hands the lock to the next waiter. */
	expire(): void {
		if (this.#holder !== null && this.#holder.expiresAt <= this.#now()) {
			this.#holder = null;
			this.#handOver();
		}
	}

	#holds(token: string): boolean {
		this.expire();
		return this.#holder?.token === token;
	}

	#take(): Lease {
		this.#holder = {
			token: this.#newToken(),
			expiresAt: this.#now() + this.#leaseMs,
		};
		return this.#holder;
	}

	#handOver(): void {
		const next = this.#waiters.shift();
		if (!next) return;
		clearTimeout(next.timer);
		next.grant(this.#take());
	}
}
