import { createFileRoute } from "@tanstack/react-router";
import {
	DEVICE_GRANT_TYPE,
	deviceFlowError,
	gitHubScopeNames,
	oauthResponse,
	readRequestParams,
} from "#/lib/device-flow";
import {
	MAX_OAUTH_CALLBACK_URL_CHARS,
	MAX_OAUTH_CLIENT_ID_CHARS,
	MAX_OAUTH_CLIENT_SECRET_CHARS,
	MAX_OAUTH_CODE_CHARS,
} from "#/lib/limits";

/** RFC 6749's grant for an authorization code, as GitHub spells it. */
const AUTHORIZATION_CODE_GRANT_TYPE = "authorization_code";

/**
 * POST /login/oauth/access_token: two grants share this endpoint. The device
 * grant is the poll `gh auth login` repeats until the user approves. The
 * authorization-code grant exchanges an app's code for a token. Like GitHub,
 * outcomes that are not yet a token (pending, slow_down, denied, expired,
 * a bad code) are 200 responses carrying an `error` field.
 */
export const Route = createFileRoute("/login/oauth/access_token")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const accept = request.headers.get("accept");
				const params = await readRequestParams(request);
				if (params.get("grant_type") === AUTHORIZATION_CODE_GRANT_TYPE) {
					return exchangeCode(request, params, accept);
				}
				const { pollDeviceCode } = await import("#/server/device-flow-store");
				if (params.get("grant_type") !== DEVICE_GRANT_TYPE) {
					return deviceFlowError("unsupported_grant_type", accept);
				}
				const outcome = await pollDeviceCode({
					clientId: (params.get("client_id") ?? "").trim(),
					deviceCode: params.get("device_code") ?? "",
				});
				if (!outcome.ok) {
					return deviceFlowError(
						outcome.error,
						accept,
						outcome.interval === undefined
							? {}
							: { interval: outcome.interval },
					);
				}
				return oauthResponse(
					{
						access_token: outcome.accessToken,
						token_type: "bearer",
						scope: gitHubScopeNames(outcome.scopes).join(","),
					},
					accept,
				);
			},
		},
	},
});

/** Seconds a refused exchange is told to wait when the limiter could not count. */
const EXCHANGE_UNCOUNTED_RETRY_SECONDS = 60;

/**
 * Counts one exchange against the caller's IP and the client id. Returns the
 * seconds to wait when refused, or null. Fails closed: an exchange the counter
 * cannot record is refused, because it is a guess at a secret.
 */
async function exchangeRefusal(
	request: Request,
	clientId: string,
): Promise<number | null> {
	const { hitRateLimit, identityFor } = await import("#/server/rate-limit");
	const byIp = await hitRateLimit("oauth-token-ip", identityFor(request, null));
	// A client id is not a user or an address: its bucket reuses the IP kind,
	// keyed by the id under its own resource name.
	const byClient = await hitRateLimit("oauth-token-client", {
		kind: "ip",
		id: clientId,
	});
	if (byIp === null || byClient === null) {
		return EXCHANGE_UNCOUNTED_RETRY_SECONDS;
	}
	const exceeded = [byIp, byClient].find((rate) => rate.exceeded);
	if (!exceeded) return null;
	return Math.max(1, exceeded.reset - Math.floor(Date.now() / 1000));
}

function tooManyExchanges(retryAfter: number): Response {
	return new Response("API rate limit exceeded for this client.\n", {
		status: 429,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"Retry-After": String(retryAfter),
		},
	});
}

async function exchangeCode(
	request: Request,
	params: URLSearchParams,
	accept: string | null,
): Promise<Response> {
	const clientId = (params.get("client_id") ?? "").trim();
	const clientSecret = params.get("client_secret") ?? "";
	const code = params.get("code") ?? "";
	const redirectUri = params.get("redirect_uri") ?? "";
	if (
		!clientId ||
		clientId.length > MAX_OAUTH_CLIENT_ID_CHARS ||
		clientSecret.length > MAX_OAUTH_CLIENT_SECRET_CHARS ||
		redirectUri.length > MAX_OAUTH_CALLBACK_URL_CHARS
	) {
		return deviceFlowError("incorrect_client_credentials", accept);
	}
	if (!code || code.length > MAX_OAUTH_CODE_CHARS) {
		return deviceFlowError("bad_verification_code", accept);
	}
	// Counted before any secret is compared: each exchange is a guess at a
	// client secret, so the per-IP and per-client buckets bound the guessing.
	const retryAfter = await exchangeRefusal(request, clientId);
	if (retryAfter !== null) return tooManyExchanges(retryAfter);
	const { exchangeAuthorizationCode } = await import(
		"#/server/oauth-apps-store"
	);
	const outcome = await exchangeAuthorizationCode({
		clientId,
		clientSecret,
		code,
		redirectUri,
	});
	if (!outcome.ok) return deviceFlowError(outcome.error, accept);
	return oauthResponse(
		{
			access_token: outcome.accessToken,
			token_type: "bearer",
			scope: gitHubScopeNames(outcome.scopes).join(","),
		},
		accept,
	);
}
