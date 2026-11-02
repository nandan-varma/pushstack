/** A live holder renews every LOCK_RENEW_MS; a crashed one's lease lapses. */
export const LOCK_LEASE_MS = 60_000;
export const LOCK_RENEW_MS = 20_000;
// Just over one lease, so a waiter always outlasts a lease minted right
// before it started waiting.
export const LOCK_ACQUIRE_TIMEOUT_MS = 65_000;
