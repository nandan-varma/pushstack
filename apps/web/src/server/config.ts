/** The env var as a positive integer; `fallback` only when it is unset or empty. */
export function positiveInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer, got "${raw}"`);
	}
	return value;
}

/** Budget for the git object cache; the parsed-result cache gets a quarter. */
export const GIT_CACHE_MAX_BYTES = positiveInt("GIT_CACHE_MAX_SIZE", 1024 ** 3);

/** TTL for immutable cache entries (mutable refs/listings use 5s). */
export const GIT_CACHE_TTL_MS = positiveInt("GIT_CACHE_TTL", 3600) * 1000;

export const GIT_HTTP_MAX_BODY_BYTES = positiveInt(
	"GIT_HTTP_MAX_BODY_BYTES",
	50 * 1024 * 1024,
);

export const SLOW_REQUEST_MS = positiveInt("SLOW_REQUEST_MS", 3000);

/**
 * Request limits for `/api/v3` and `/api/git` (src/server/rate-limit.ts):
 * requests per fixed window, per user when authenticated and per client IP
 * when anonymous. Defaults follow GitHub's REST API (5000/h, 60/h).
 */
export const RATE_LIMIT_WINDOW_SECONDS = positiveInt(
	"RATE_LIMIT_WINDOW_SECONDS",
	3600,
);
export const RATE_LIMIT_API_AUTHENTICATED = positiveInt(
	"RATE_LIMIT_API_AUTHENTICATED",
	5000,
);
export const RATE_LIMIT_API_ANONYMOUS = positiveInt(
	"RATE_LIMIT_API_ANONYMOUS",
	60,
);
export const RATE_LIMIT_API_WRITE = positiveInt("RATE_LIMIT_API_WRITE", 1000);
export const RATE_LIMIT_GIT_READ_AUTHENTICATED = positiveInt(
	"RATE_LIMIT_GIT_READ_AUTHENTICATED",
	2000,
);
export const RATE_LIMIT_GIT_READ_ANONYMOUS = positiveInt(
	"RATE_LIMIT_GIT_READ_ANONYMOUS",
	120,
);
export const RATE_LIMIT_GIT_WRITE = positiveInt("RATE_LIMIT_GIT_WRITE", 500);
export const RATE_LIMIT_AUTH_FAILURES = positiveInt(
	"RATE_LIMIT_AUTH_FAILURES",
	30,
);
