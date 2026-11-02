import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaseQueue, LockTimeoutError } from "../lease-queue";

let now = 0;
let counter = 0;
const queue = (restored?: { token: string; expiresAt: number }) =>
	new LeaseQueue(
		{ leaseMs: 1000, now: () => now, newToken: () => `t${++counter}` },
		restored,
	);

beforeEach(() => {
	vi.useFakeTimers();
	now = 0;
	counter = 0;
});
afterEach(() => vi.useRealTimers());

describe("LeaseQueue", () => {
	it("grants a free lock immediately", async () => {
		const lock = queue();
		const lease = await lock.acquire(5000);
		expect(lease).toEqual({ token: "t1", expiresAt: 1000 });
		expect(lock.holder).toEqual(lease);
	});

	it("queues waiters in arrival order and hands over on release", async () => {
		const lock = queue();
		const first = await lock.acquire(5000);
		const order: string[] = [];
		const second = lock
			.acquire(5000)
			.then((lease) => order.push(`2:${lease.token}`));
		const third = lock
			.acquire(5000)
			.then((lease) => order.push(`3:${lease.token}`));

		lock.release(first.token);
		await second;
		expect(order).toEqual(["2:t2"]);
		lock.release("t2");
		await third;
		expect(order).toEqual(["2:t2", "3:t3"]);
	});

	it("ignores a stale token's release and renewal", async () => {
		const lock = queue();
		const lease = await lock.acquire(5000);
		lock.release("someone-else");
		expect(lock.holder).toEqual(lease);
		expect(lock.renew("someone-else")).toBe(false);
	});

	it("extends the lease on renewal, so a long operation keeps the lock", async () => {
		const lock = queue();
		const { token } = await lock.acquire(5000);
		now = 900;
		expect(lock.renew(token)).toBe(true);
		now = 1800;
		expect(lock.renew(token)).toBe(true);
		expect(lock.holder).toEqual({ token, expiresAt: 2800 });
	});

	it("hands a lapsed lease to the next waiter and refuses the old holder's renewal", async () => {
		const lock = queue();
		const { token } = await lock.acquire(5000);
		const next = lock.acquire(5000);
		now = 1000;
		lock.expire();
		expect((await next).token).toBe("t2");
		expect(lock.renew(token)).toBe(false);
	});

	it("takes over an already lapsed lease on acquire", async () => {
		const lock = queue({ token: "ghost", expiresAt: 500 });
		now = 600;
		expect((await lock.acquire(5000)).token).toBe("t1");
	});

	it("times a waiter out without disturbing the holder or later waiters", async () => {
		const lock = queue();
		const holder = await lock.acquire(60_000);
		const timedOut = lock.acquire(2000);
		const patient = lock.acquire(60_000);
		const rejected = expect(timedOut).rejects.toBeInstanceOf(LockTimeoutError);
		await vi.advanceTimersByTimeAsync(2000);
		await rejected;
		lock.release(holder.token);
		expect((await patient).token).toBe("t2");
	});
});
