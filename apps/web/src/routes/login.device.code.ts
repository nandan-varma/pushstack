import { createFileRoute } from "@tanstack/react-router";
import {
	deviceFlowError,
	oauthResponse,
	RequestBodyTooLargeError,
	readRequestParams,
	requestBodyTooLarge,
	tokenScopesFromGitHub,
} from "#/lib/device-flow";
import { MAX_DEVICE_CLIENT_ID_CHARS } from "#/lib/limits";
import { hitRateLimit, identityFor } from "#/server/rate-limit";

/**
 * POST /login/device/code: start a device-flow login (what `gh auth login`
 * calls first). The client then shows `user_code` and `verification_uri`
 * and polls /login/oauth/access_token with `device_code`.
 */
export const Route = createFileRoute("/login/device/code")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// The store pulls in the database: load it only for this request.
				const { createDeviceCode } = await import("#/server/device-flow-store");
				const accept = request.headers.get("accept");
				// Counted before the body is read: a flood of starts costs one
				// counter write each, and never reaches the code table.
				const rate = await hitRateLimit(
					"device-code",
					identityFor(request, null),
				);
				if (rate?.exceeded) {
					return new Response("API rate limit exceeded for this client.\n", {
						status: 429,
						headers: {
							"content-type": "text/plain; charset=utf-8",
							"Retry-After": String(
								Math.max(1, rate.reset - Math.floor(Date.now() / 1000)),
							),
						},
					});
				}
				let params: URLSearchParams;
				try {
					params = await readRequestParams(request);
				} catch (error) {
					if (error instanceof RequestBodyTooLargeError) {
						return requestBodyTooLarge();
					}
					throw error;
				}
				const clientId = (params.get("client_id") ?? "").trim();
				if (!clientId || clientId.length > MAX_DEVICE_CLIENT_ID_CHARS) {
					return deviceFlowError("incorrect_client_credentials", accept);
				}
				const grant = await createDeviceCode({
					clientId,
					scopes: tokenScopesFromGitHub(params.get("scope") ?? ""),
				});
				return oauthResponse(
					{
						device_code: grant.deviceCode,
						user_code: grant.userCode,
						verification_uri: `${new URL(request.url).origin}/login/device`,
						expires_in: grant.expiresIn,
						interval: grant.interval,
					},
					accept,
				);
			},
		},
	},
});
