/**
 * Fixed-window counters for Better Auth's rate limiter, kept in Postgres.
 *
 * Better Auth's own default keeps them in a module-level `Map`
 * (`options.rateLimit.storage` resolves to `"memory"` when nothing else is
 * configured). On a serverless deployment that is one `Map` per warm instance,
 * so a configured "20 requests per 60 seconds" is really 20 × however many
 * instances happen to be serving, and an attacker who spreads requests across
 * instances sees a ceiling far above what the configuration claims. The
 * counters have to live where every instance can see them.
 *
 * One statement does the whole decision: Postgres either starts a new window or
 * advances the current one, and reports whether the caller is inside the limit.
 * Two concurrent requests therefore cannot both read "under the limit" — the
 * check is the write. That is also why the elapsed-time and retry arithmetic
 * happens in SQL: one clock decides, and no driver date parsing is involved.
 *
 * This is a fixed window (measured from the window's first request), where
 * Better Auth's in-memory backend extends its window with each request. A fixed
 * window is the stricter of the two and is what the configured name suggests.
 */
import { sql } from "drizzle-orm";
import { db } from "#/db";
import { logWarn } from "./perf-log";

export interface RateLimitRule {
	/** Window length in seconds. */
	window: number;
	/** Requests allowed per window. */
	max: number;
}

export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the caller may retry; `null` when allowed. */
	retryAfter: number | null;
}

/** The shape Better Auth's `rateLimit.customStorage` must provide. */
export interface RateLimitStorage {
	consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

interface DecisionRow extends Record<string, unknown> {
	allowed: boolean;
	retry_after: number;
}

/**
 * Expired rows are harmless (they only occupy a row until their key is seen
 * again), but they would accumulate one per caller forever, so they are
 * expired by a prune at most once a minute per instance.
 */
const PRUNE_INTERVAL_MS = 60_000;

/**
 * The longest window any rule has needed so far. A prune must never remove a
 * row a longer-windowed rule is still counting against, so it uses this
 * high-water mark rather than the window of whichever rule happens to prune
 * first — the same thing Better Auth's database-backed limiter tracks.
 */
let longestWindowSeconds = 0;
let lastPrunedAt = 0;

/**
 * The clock-skew-free expiry prune is maintenance, not part of the decision, so
 * a failure here is logged rather than failing the request that triggered it.
 */
async function pruneExpiredCounters(): Promise<void> {
	const now = Date.now();
	if (now - lastPrunedAt < PRUNE_INTERVAL_MS) return;
	lastPrunedAt = now;
	try {
		await db.execute(
			sql`delete from rate_limits where window_started_at < now() - make_interval(secs => ${longestWindowSeconds})`,
		);
	} catch (error) {
		logWarn("rate-limit", "Failed to prune expired rate-limit counters", error);
	}
}

export const rateLimitStorage: RateLimitStorage = {
	async consume(key, rule) {
		longestWindowSeconds = Math.max(longestWindowSeconds, rule.window);

		const result = await db.execute<DecisionRow>(sql`
			insert into rate_limits (key, count, window_started_at)
			values (${key}, 1, now())
			on conflict (key) do update set
				count = case
					when rate_limits.window_started_at <= now() - make_interval(secs => ${rule.window})
						then 1
					else rate_limits.count + 1
				end,
				window_started_at = case
					when rate_limits.window_started_at <= now() - make_interval(secs => ${rule.window})
						then now()
					else rate_limits.window_started_at
				end
			returning
				count <= ${rule.max} as allowed,
				greatest(
					0,
					ceil(
						extract(
							epoch from (
								window_started_at
								+ make_interval(secs => ${rule.window})
								- now()
							)
						)
					)
				)::int as retry_after
		`);

		const row = result.rows[0];
		if (!row) throw new Error("Rate-limit counter upsert returned no row");

		await pruneExpiredCounters();

		return {
			allowed: row.allowed,
			retryAfter: row.allowed ? null : row.retry_after,
		};
	},
};
