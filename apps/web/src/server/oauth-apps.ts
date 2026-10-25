import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { oauthApps } from "#/db/app-schema";
import { tokenScopesFromGitHub } from "#/lib/device-flow";
import {
	MAX_OAUTH_APP_NAME_CHARS,
	MAX_OAUTH_APPS_PER_USER,
	MAX_OAUTH_CALLBACK_URL_CHARS,
	MAX_OAUTH_CLIENT_ID_CHARS,
	MAX_OAUTH_SCOPE_CHARS,
	MAX_OAUTH_STATE_CHARS,
} from "#/lib/limits";
import {
	authorizationRedirect,
	isSameOriginRequest,
	isValidCallbackUrl,
} from "#/lib/oauth-apps";
import {
	createOAuthApp,
	deleteOAuthApp,
	findAuthorizationApp,
	issueAuthorizationCode,
	listAuthorizedApps,
	listOAuthApps,
	revokeAuthorizedApp,
} from "./oauth-apps-store";
import { getCurrentUser } from "./session";

const callbackUrl = z
	.string()
	.trim()
	.max(MAX_OAUTH_CALLBACK_URL_CHARS)
	.refine(isValidCallbackUrl, "The callback URL must be an absolute https URL");

/** The apps the signed-in user registered. Never includes a secret. */
export const getOAuthApps = createServerFn({ method: "GET" }).handler(
	async () => {
		const user = await getCurrentUser();
		return listOAuthApps(user.id);
	},
);

/** Registers an app. The response carries its client secret, once. */
export const registerOAuthApp = createServerFn({ method: "POST" })
	.validator(
		z.object({
			name: z.string().trim().min(1).max(MAX_OAUTH_APP_NAME_CHARS),
			callbackUrl,
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const [{ total }] = await db
			.select({ total: count() })
			.from(oauthApps)
			.where(eq(oauthApps.userId, user.id));
		if (total >= MAX_OAUTH_APPS_PER_USER) {
			throw new Error(
				`You can register at most ${MAX_OAUTH_APPS_PER_USER} OAuth apps`,
			);
		}
		return createOAuthApp({ userId: user.id, ...data });
	});

export const removeOAuthApp = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		return { deleted: await deleteOAuthApp({ userId: user.id, id: data.id }) };
	});

/** The apps that hold a token for the signed-in user. */
export const getAuthorizedApps = createServerFn({ method: "GET" }).handler(
	async () => {
		const user = await getCurrentUser();
		return listAuthorizedApps(user.id);
	},
);

/** Revokes every token the user holds through one app. */
export const revokeAuthorizedApps = createServerFn({ method: "POST" })
	.validator(z.object({ appId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		return {
			revoked: await revokeAuthorizedApp({
				userId: user.id,
				appId: data.appId,
			}),
		};
	});

const authorizationParams = z.object({
	client_id: z.string().max(MAX_OAUTH_CLIENT_ID_CHARS),
	redirect_uri: z.string().max(MAX_OAUTH_CALLBACK_URL_CHARS),
	scope: z.string().max(MAX_OAUTH_SCOPE_CHARS),
	state: z.string().max(MAX_OAUTH_STATE_CHARS),
});

/**
 * What the consent page shows for an authorization request: the app and the
 * scopes it asks for, or why the request cannot proceed. A bad client or a
 * redirect URI that is not the registered one is reported here, and the user
 * is never redirected to it.
 */
export const getAuthorizationRequest = createServerFn({ method: "GET" })
	.validator(authorizationParams)
	.handler(async ({ data }) => {
		await getCurrentUser();
		const found = await findAuthorizationApp({
			clientId: data.client_id,
			redirectUri: data.redirect_uri,
		});
		if (!found.ok) return { ok: false as const, error: found.error };
		return {
			ok: true as const,
			app: { name: found.app.name, callbackUrl: found.app.callbackUrl },
			scopes: tokenScopesFromGitHub(data.scope),
		};
	});

/**
 * Approve or deny an authorization request. The redirect target is the app's
 * registered callback, re-checked here: the page's values are never trusted.
 * The request must come from this origin, so a page on another site cannot
 * submit the decision for the signed-in user (a cross-site form post carries
 * no matching Origin).
 */
export const decideAuthorization = createServerFn({ method: "POST" })
	.validator(authorizationParams.extend({ approve: z.boolean() }))
	.handler(async ({ data }) => {
		const request = getRequest();
		if (!isSameOriginRequest(request)) {
			throw new Error("This request must come from this site");
		}
		const user = await getCurrentUser();
		const found = await findAuthorizationApp({
			clientId: data.client_id,
			redirectUri: data.redirect_uri,
		});
		if (!found.ok) throw new Error("This authorization request is not valid");

		const state: Record<string, string> =
			data.state === "" ? {} : { state: data.state };
		if (!data.approve) {
			return {
				redirectTo: authorizationRedirect(found.app.callbackUrl, {
					error: "access_denied",
					...state,
				}),
			};
		}
		const code = await issueAuthorizationCode({
			appId: found.app.id,
			userId: user.id,
			redirectUri: found.app.callbackUrl,
			scopes: tokenScopesFromGitHub(data.scope),
		});
		return {
			redirectTo: authorizationRedirect(found.app.callbackUrl, {
				code,
				...state,
			}),
		};
	});
