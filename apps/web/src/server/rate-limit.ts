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
import * as config from "./config";
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

/* ------------------------------------------------------------------ *
 * Request limits for /api/v3 and /api/git (GitHub-shaped).
 *
 * Same table and the same single-statement upsert as above, with keys in
 * their own `gh:` namespace. One round trip per metered request.
 * ------------------------------------------------------------------ */

export type RateLimitResource = "core" | "core-write" | "git" | "git-write";

export interface RateStatus {
	resource: RateLimitResource;
	limit: number;
	used: number;
	remaining: number;
	/** Epoch seconds at which the window ends. */
	reset: number;
	exceeded: boolean;
	/** "user ID 5" or an IP address, for GitHub's error message. */
	identity: string;
}

/** Who is being metered: a user (authenticated) or a client IP (anonymous). */
export interface RateIdentity {
	kind: "user" | "ip";
	id: string;
}

/**
 * The client IP. Vercel overwrites `x-forwarded-for` with the connecting
 * address, so its leftmost entry is trustworthy there. A request with no
 * address shares one "unknown" bucket rather than being unlimited.
 */
export function clientIp(request: Request): string {
	const forwarded = request.headers
		.get("x-forwarded-for")
		?.split(",")[0]
		?.trim();
	return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function identityFor(
	request: Request,
	userId: string | null,
): RateIdentity {
	return userId
		? { kind: "user", id: userId }
		: { kind: "ip", id: clientIp(request) };
}

const describeIdentity = (who: RateIdentity) =>
	who.kind === "user" ? `user ID ${who.id}` : who.id;

/** The limit for a resource and identity kind. */
function limitFor(resource: RateLimitResource, kind: "user" | "ip"): number {
	switch (resource) {
		case "core":
			return kind === "user"
				? config.RATE_LIMIT_API_AUTHENTICATED
				: config.RATE_LIMIT_API_ANONYMOUS;
		case "core-write":
			return config.RATE_LIMIT_API_WRITE;
		case "git":
			return kind === "user"
				? config.RATE_LIMIT_GIT_READ_AUTHENTICATED
				: config.RATE_LIMIT_GIT_READ_ANONYMOUS;
		case "git-write":
			return config.RATE_LIMIT_GIT_WRITE;
	}
}

const bucketKey = (resource: RateLimitResource, who: RateIdentity) =>
	`gh:${resource}:${who.kind}:${who.id}`;

interface StatusRow extends Record<string, unknown> {
	count: number;
	reset: number;
}

function toStatus(
	resource: RateLimitResource,
	who: RateIdentity,
	row: StatusRow | undefined,
): RateStatus {
	const limit = limitFor(resource, who.kind);
	const used = row ? Number(row.count) : 0;
	return {
		resource,
		limit,
		used: Math.min(used, limit),
		remaining: Math.max(0, limit - used),
		reset: row
			? Number(row.reset)
			: Math.ceil(Date.now() / 1000) + config.RATE_LIMIT_WINDOW_SECONDS,
		exceeded: used > limit,
		identity: describeIdentity(who),
	};
}

/**
 * Count one request against `resource` for `who` and report the bucket.
 *
 * Fails open: this is abuse mitigation, not authorization, so a limiter error
 * (database down, table missing) logs and serves the request (returns null)
 * instead of turning a Postgres hiccup into an outage. Do not "fix" it to
 * fail closed.
 */
export async function hitRateLimit(
	resource: RateLimitResource,
	who: RateIdentity,
): Promise<RateStatus | null> {
	const window = config.RATE_LIMIT_WINDOW_SECONDS;
	longestWindowSeconds = Math.max(longestWindowSeconds, window);
	try {
		const result = await db.execute<StatusRow>(sql`
			insert into rate_limits (key, count, window_started_at)
			values (${bucketKey(resource, who)}, 1, now())
			on conflict (key) do update set
				count = case
					when rate_limits.window_started_at <= now() - make_interval(secs => ${window})
						then 1
					else rate_limits.count + 1
				end,
				window_started_at = case
					when rate_limits.window_started_at <= now() - make_interval(secs => ${window})
						then now()
					else rate_limits.window_started_at
				end
			returning
				count,
				extract(epoch from (window_started_at + make_interval(secs => ${window})))::bigint as reset
		`);
		await pruneExpiredCounters();
		return toStatus(resource, who, result.rows[0]);
	} catch (error) {
		logWarn("rate-limit", "Request limiter failed; serving the request", error);
		return null;
	}
}

/** The current state of several buckets, without counting a request. */
export async function peekRateLimits(
	resources: RateLimitResource[],
	who: RateIdentity,
): Promise<RateStatus[]> {
	const window = config.RATE_LIMIT_WINDOW_SECONDS;
	const keys = resources.map((resource) => bucketKey(resource, who));
	const rows = new Map<string, StatusRow>();
	try {
		const result = await db.execute<StatusRow & { key: string }>(sql`
			select key, count,
				extract(epoch from (window_started_at + make_interval(secs => ${window})))::bigint as reset
			from rate_limits
			where key in (${sql.join(
				keys.map((key) => sql`${key}`),
				sql`, `,
			)})
				and window_started_at > now() - make_interval(secs => ${window})
		`);
		for (const row of result.rows) rows.set(row.key, row);
	} catch (error) {
		logWarn("rate-limit", "Request limiter peek failed", error);
	}
	return resources.map((resource, index) =>
		toStatus(resource, who, rows.get(keys[index] as string)),
	);
}

/** GitHub's `X-RateLimit-*` headers (and `Retry-After` once exceeded). */
export function rateLimitHeaders(status: RateStatus): Record<string, string> {
	const headers: Record<string, string> = {
		"X-RateLimit-Limit": String(status.limit),
		"X-RateLimit-Remaining": String(status.remaining),
		"X-RateLimit-Reset": String(status.reset),
		"X-RateLimit-Used": String(status.used),
		"X-RateLimit-Resource": status.resource.startsWith("core") ? "core" : "git",
	};
	if (status.exceeded) {
		headers["Retry-After"] = String(
			Math.max(1, status.reset - Math.floor(Date.now() / 1000)),
		);
	}
	return headers;
}

/** GitHub's message for an exhausted primary limit. */
export const rateLimitExceededMessage = (status: RateStatus) =>
	`API rate limit exceeded for ${status.identity}.`;
