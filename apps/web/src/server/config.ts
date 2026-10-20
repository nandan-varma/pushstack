/** Server tuning knobs read from the environment, parsed once. */

function positiveInt(name: string, fallback: number): number {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Budget for the git object cache; the parsed-result cache gets a quarter. */
export const GIT_CACHE_MAX_BYTES = positiveInt("GIT_CACHE_MAX_SIZE", 1024 ** 3);

/** TTL for immutable cache entries (mutable refs/listings use 5s). */
export const GIT_CACHE_TTL_MS = positiveInt("GIT_CACHE_TTL", 3600) * 1000;

/** Request body cap for upload-pack/receive-pack. */
export const GIT_HTTP_MAX_BODY_BYTES = positiveInt(
	"GIT_HTTP_MAX_BODY_BYTES",
	50 * 1024 * 1024,
);

/** Requests slower than this are reported as slow (a warning, with the step breakdown). */
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
/** `/api/v3` reads (GET/HEAD), authenticated. */
export const RATE_LIMIT_API_AUTHENTICATED = positiveInt(
	"RATE_LIMIT_API_AUTHENTICATED",
	5000,
);
/** `/api/v3` reads, anonymous (per IP). */
export const RATE_LIMIT_API_ANONYMOUS = positiveInt(
	"RATE_LIMIT_API_ANONYMOUS",
	60,
);
/** `/api/v3` mutating calls, per authenticated user (their own bucket). */
export const RATE_LIMIT_API_WRITE = positiveInt("RATE_LIMIT_API_WRITE", 1000);
/** Git clone/fetch requests (info/refs and upload-pack), authenticated. */
export const RATE_LIMIT_GIT_READ_AUTHENTICATED = positiveInt(
	"RATE_LIMIT_GIT_READ_AUTHENTICATED",
	2000,
);
/** Git clone/fetch requests, anonymous (per IP). */
export const RATE_LIMIT_GIT_READ_ANONYMOUS = positiveInt(
	"RATE_LIMIT_GIT_READ_ANONYMOUS",
	120,
);
/** Git push requests (info/refs and receive-pack), per authenticated user. */
export const RATE_LIMIT_GIT_WRITE = positiveInt("RATE_LIMIT_GIT_WRITE", 500);
