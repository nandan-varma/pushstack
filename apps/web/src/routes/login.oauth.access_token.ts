import { createFileRoute } from "@tanstack/react-router";
import {
	DEVICE_GRANT_TYPE,
	deviceFlowError,
	gitHubScopeNames,
	oauthResponse,
	readRequestParams,
} from "#/lib/device-flow";

/**
 * POST /login/oauth/access_token: the poll `gh auth login` repeats until the
 * user approves. Like GitHub, outcomes that are not yet a token (pending,
 * slow_down, denied, expired) are 200 responses carrying an `error` field.
 */
export const Route = createFileRoute("/login/oauth/access_token")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { pollDeviceCode } = await import("#/server/device-flow-store");
				const accept = request.headers.get("accept");
				const params = await readRequestParams(request);
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
