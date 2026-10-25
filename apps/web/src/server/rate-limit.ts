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

/** Request-limit keys (`gh:…`) all use the one configured window. */
const REQUEST_KEY_PATTERN = "gh:%";
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
		// The table is shared by two families with different windows: Better
		// Auth's (high-water mark of the rules seen here) and the `gh:` request
		// limits (config). Each is pruned by its own window, so one family's
		// short window never deletes the other's live buckets.
		await db.execute(sql`
			delete from rate_limits where
				(key like ${REQUEST_KEY_PATTERN}
					and window_started_at < now() - make_interval(secs => ${config.RATE_LIMIT_WINDOW_SECONDS}))
				or (key not like ${REQUEST_KEY_PATTERN}
					and ${longestWindowSeconds} > 0
					and window_started_at < now() - make_interval(secs => ${longestWindowSeconds}))
		`);
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
 * Request limits for /api/v3 and git smart HTTP (GitHub-shaped).
 *
 * Same table and the same single-statement upsert as above, with keys in
 * their own `gh:` namespace. One round trip per metered request.
 * ------------------------------------------------------------------ */

export type RateLimitResource =
	| "core"
	| "core-write"
	| "graphql"
	| "git"
	| "git-write"
	| "auth-failure"
	| "oauth-token-ip"
	| "oauth-token-client";

export interface RateStatus {
	resource: RateLimitResource;
	limit: number;
	used: number;
	remaining: number;
	/** Epoch seconds at which the window ends. */
	reset: number;
	exceeded: boolean;
	identity: string;
}

export interface RateIdentity {
	kind: "user" | "ip";
	id: string;
}

/**
 * The client IP: `x-vercel-forwarded-for` (set by Vercel, not by the caller),
 * then `x-real-ip`, then the leftmost `x-forwarded-for` entry. A request with
 * no address shares one "unknown" bucket rather than being unlimited.
 */
function clientIp(request: Request): string {
	const { headers } = request;
	return (
		headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
		headers.get("x-real-ip")?.trim() ||
		headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		"unknown"
	);
}

/**
 * IPs that failed credentials recently on THIS instance. Only they pay the
 * database read before authenticating, so clean requests stay at one limiter
 * round trip. Bounded; a flood from many instances is still counted (and
 * hinted) on each instance it reaches.
 */
const FAILURE_HINT_TTL_MS = 5 * 60_000;
const FAILURE_HINT_MAX = 5_000;
const recentFailures = new Map<string, number>();

function hintFailure(ip: string): void {
	recentFailures.delete(ip);
	recentFailures.set(ip, Date.now() + FAILURE_HINT_TTL_MS);
	while (recentFailures.size > FAILURE_HINT_MAX) {
		const oldest = recentFailures.keys().next().value;
		if (oldest === undefined) break;
		recentFailures.delete(oldest);
	}
}

function recentlyFailed(ip: string): boolean {
	const expires = recentFailures.get(ip);
	if (expires === undefined) return false;
	if (expires > Date.now()) return true;
	recentFailures.delete(ip);
	return false;
}

/**
 * Whether this IP has used up its failed-credential budget (no counting).
 * Free (no database) unless this instance saw the IP fail recently.
 */
export async function authFailuresExhausted(
	request: Request,
): Promise<RateStatus | null> {
	const who = identityFor(request, null);
	if (!recentlyFailed(who.id)) return null;
	const [status] = await peekRateLimits(["auth-failure"], who);
	return status && status.remaining === 0 ? status : null;
}

export function recordAuthFailure(
	request: Request,
): Promise<RateStatus | null> {
	const who = identityFor(request, null);
	hintFailure(who.id);
	return hitRateLimit("auth-failure", who);
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

function limitFor(resource: RateLimitResource, kind: "user" | "ip"): number {
	switch (resource) {
		case "core":
			return kind === "user"
				? config.RATE_LIMIT_API_AUTHENTICATED
				: config.RATE_LIMIT_API_ANONYMOUS;
		case "core-write":
			return config.RATE_LIMIT_API_WRITE;
		// GitHub's GraphQL budget is points (query cost), same size as core's.
		case "graphql":
			return config.RATE_LIMIT_API_AUTHENTICATED;
		case "git":
			return kind === "user"
				? config.RATE_LIMIT_GIT_READ_AUTHENTICATED
				: config.RATE_LIMIT_GIT_READ_ANONYMOUS;
		case "git-write":
			return config.RATE_LIMIT_GIT_WRITE;
		case "auth-failure":
			return config.RATE_LIMIT_AUTH_FAILURES;
		case "oauth-token-ip":
			return config.RATE_LIMIT_OAUTH_TOKEN_IP;
		case "oauth-token-client":
			return config.RATE_LIMIT_OAUTH_TOKEN_CLIENT;
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
 * Buckets this instance has seen over their limit, with the window's reset
 * (epoch seconds). Counters only grow within a window, so an exhausted bucket
 * stays exhausted until its reset: denying from memory is exact and costs no
 * database round trip or handler work. It is per instance: the first
 * over-limit request each instance sees (and any that were in flight with it)
 * still ran its read handler concurrently with the count, and that result is
 * discarded. Bounded; entries lapse at their reset.
 */
const EXHAUSTED_MAX = 5_000;
const exhaustedBuckets = new Map<string, number>();

function rememberExhausted(
	resource: RateLimitResource,
	who: RateIdentity,
	reset: number,
): void {
	const key = bucketKey(resource, who);
	exhaustedBuckets.delete(key);
	exhaustedBuckets.set(key, reset);
	while (exhaustedBuckets.size > EXHAUSTED_MAX) {
		const oldest = exhaustedBuckets.keys().next().value;
		if (oldest === undefined) break;
		exhaustedBuckets.delete(oldest);
	}
}

/** Test-only: forget remembered exhaustion to simulate a window rollover. */
export function resetRateLimitMemory(): void {
	exhaustedBuckets.clear();
}

/**
 * The exhausted bucket for `resource`/`who` if this instance already saw it
 * over its limit in the current window (no database), else null.
 */
export function knownExhausted(
	resource: RateLimitResource,
	who: RateIdentity,
): RateStatus | null {
	const key = bucketKey(resource, who);
	const reset = exhaustedBuckets.get(key);
	if (reset === undefined) return null;
	if (reset <= Math.floor(Date.now() / 1000)) {
		exhaustedBuckets.delete(key);
		return null;
	}
	const limit = limitFor(resource, who.kind);
	return {
		resource,
		limit,
		used: limit,
		remaining: 0,
		reset,
		exceeded: true,
		identity: describeIdentity(who),
	};
}

/**
 * Count one request (or `amount` points: a GraphQL query's cost) against
 * `resource` for `who` and report the bucket.
 *
 * Fails open: this is abuse mitigation, not authorization, so a limiter error
 * (database down, table missing) logs and serves the request (returns null)
 * instead of turning a Postgres hiccup into an outage. Do not "fix" it to
 * fail closed.
 */
export async function hitRateLimit(
	resource: RateLimitResource,
	who: RateIdentity,
	amount = 1,
): Promise<RateStatus | null> {
	const window = config.RATE_LIMIT_WINDOW_SECONDS;
	try {
		const result = await db.execute<StatusRow>(sql`
			insert into rate_limits (key, count, window_started_at)
			values (${bucketKey(resource, who)}, ${amount}, now())
			on conflict (key) do update set
				count = case
					when rate_limits.window_started_at <= now() - make_interval(secs => ${window})
						then ${amount}
					else rate_limits.count + ${amount}
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
		const status = toStatus(resource, who, result.rows[0]);
		if (status.exceeded) rememberExhausted(resource, who, status.reset);
		return status;
	} catch (error) {
		logWarn("rate-limit", "Request limiter failed; serving the request", error);
		return null;
	}
}

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

export function rateLimitHeaders(status: RateStatus): Record<string, string> {
	const headers: Record<string, string> = {
		"X-RateLimit-Limit": String(status.limit),
		"X-RateLimit-Remaining": String(status.remaining),
		"X-RateLimit-Reset": String(status.reset),
		"X-RateLimit-Used": String(status.used),
		"X-RateLimit-Resource":
			status.resource === "git" || status.resource === "git-write"
				? "git"
				: status.resource === "graphql"
					? "graphql"
					: "core",
	};
	if (status.exceeded) {
		headers["Retry-After"] = String(
			Math.max(1, status.reset - Math.floor(Date.now() / 1000)),
		);
	}
	return headers;
}

export const rateLimitExceededMessage = (status: RateStatus) =>
	`API rate limit exceeded for ${status.identity}.`;
