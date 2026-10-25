import { createFileRoute } from "@tanstack/react-router";
import {
	deviceFlowError,
	oauthResponse,
	readRequestParams,
	tokenScopesFromGitHub,
} from "#/lib/device-flow";
import { MAX_DEVICE_CLIENT_ID_CHARS } from "#/lib/limits";

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
				const params = await readRequestParams(request);
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
