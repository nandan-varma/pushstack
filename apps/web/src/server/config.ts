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
