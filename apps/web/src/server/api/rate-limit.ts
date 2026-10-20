/**
 * GitHub-style request limits for `/api/v3`: the per-request metering the
 * dispatcher applies (user when authenticated, client IP otherwise; mutating
 * calls have their own per-user bucket) and `GET /rate_limit`, which reports
 * the buckets without counting itself.
 */
import {
	hitRateLimit,
	identityFor,
	peekRateLimits,
	type RateStatus,
	rateLimitExceededMessage,
	rateLimitHeaders,
} from "../rate-limit";
import type { ApiContext, Caller } from "./auth";
import { ApiError, json } from "./http";

const READ_METHODS = new Set(["GET", "HEAD"]);

/** Thrown when the limit is exhausted; carries the status for the headers. */
export class RateLimitedError extends ApiError {
	constructor(readonly rate: RateStatus) {
		super(403, rateLimitExceededMessage(rate));
	}
}

/**
 * Count this request. Returns the bucket (null when the limiter failed open)
 * and throws {@link RateLimitedError} when it is over its limit.
 */
export async function meterApiRequest(
	request: Request,
	caller: Caller | null,
): Promise<RateStatus | null> {
	const who = identityFor(request, caller?.userId ?? null);
	const resource =
		caller && !READ_METHODS.has(request.method) ? "core-write" : "core";
	const rate = await hitRateLimit(resource, who);
	if (rate?.exceeded) throw new RateLimitedError(rate);
	return rate;
}

export function applyRateHeaders(
	response: Response,
	rate: RateStatus | null,
): Response {
	if (!rate) return response;
	for (const [name, value] of Object.entries(rateLimitHeaders(rate))) {
		response.headers.set(name, value);
	}
	return response;
}

const shape = ({ limit, used, remaining, reset }: RateStatus) => ({
	limit,
	used,
	remaining,
	reset,
});

/** `GET /rate_limit`: free to call, never counted. */
export async function getRateLimit(ctx: ApiContext): Promise<Response> {
	const who = identityFor(ctx.request, ctx.caller?.userId ?? null);
	const [core, git] = await peekRateLimits(["core", "git"], who);
	const resources = {
		core: shape(core as RateStatus),
		git: shape(git as RateStatus),
	};
	let writes: RateStatus | undefined;
	if (ctx.caller) {
		[writes] = await peekRateLimits(["core-write"], who);
	}
	return json(
		{
			resources: { ...resources, ...(writes && { core_write: shape(writes) }) },
			rate: resources.core,
		},
		200,
		rateLimitHeaders(core as RateStatus),
	);
}
