/**
 * Who is downloading, for the streamed file routes (source archives, release
 * assets): a PAT in `Authorization` (read scope) or the session, metered like
 * the REST API. Plain-text error responses, as a browser or curl shows them.
 */
import { tokenAllows } from "#/lib/token-scopes";
import { authenticateRequest } from "./api/auth";
import { meterApiRequest, RateLimitedError } from "./api/rate-limit";
import { rateLimitHeaders } from "./rate-limit";
import { getCurrentUserOptional } from "./session";

export const plainTextHeaders = {
	"Content-Type": "text/plain; charset=utf-8",
};

export const downloadNotFound = () =>
	new Response("Not found", { status: 404, headers: plainTextHeaders });

/**
 * The caller's user id (null when anonymous), or the response to send:
 * 401 for bad credentials, 404 for a token without read scope, 403 when
 * rate limited.
 */
export async function resolveDownloader(
	request: Request,
): Promise<{ userId: string | null } | { response: Response }> {
	let userId: string | null = null;
	if (request.headers.has("authorization")) {
		const caller = await authenticateRequest(request).catch(() => null);
		if (!caller) {
			return {
				response: new Response("Bad credentials", {
					status: 401,
					headers: plainTextHeaders,
				}),
			};
		}
		if (!tokenAllows(caller.scopes, "repo:read")) {
			return { response: downloadNotFound() };
		}
		userId = caller.userId;
	} else {
		userId = (await getCurrentUserOptional())?.id ?? null;
	}
	// Metered like the REST API (the caller's bucket, or the client IP),
	// before any repository work.
	try {
		await meterApiRequest(request, userId ? { userId, scopes: [] } : null);
	} catch (error) {
		if (!(error instanceof RateLimitedError)) throw error;
		return {
			response: new Response(error.message, {
				status: 403,
				headers: { ...plainTextHeaders, ...rateLimitHeaders(error.rate) },
			}),
		};
	}
	return { userId };
}
