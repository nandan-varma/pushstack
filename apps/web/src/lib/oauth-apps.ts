/**
 * OAuth apps and the authorization-code flow, as pure helpers: the credentials
 * an app is issued, the callback URL rules, and the redirect a consent
 * decision sends the user back to. Storage lives in server/oauth-apps-store.ts.
 */
import { randomBytes } from "./bytes";
import { MAX_OAUTH_CALLBACK_URL_CHARS } from "./limits";

/** An authorization code is good for ten minutes, as GitHub's is. */
export const AUTHORIZATION_CODE_LIFETIME_SECONDS = 600;

const hex = (bytes: number) =>
	Array.from(randomBytes(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

/** `Iv1.` plus 16 hex characters, the shape GitHub gives OAuth app ids. */
export const newOAuthClientId = (): string => `Iv1.${hex(8)}`;

/** 40 hex characters, the length of GitHub's client secrets. */
export const newOAuthClientSecret = (): string => hex(20);

/** The code the user's browser carries back to the callback URL. */
export const newAuthorizationCode = (): string => hex(20);

/**
 * A callback URL an app may register: absolute, without a fragment or
 * credentials, and https. Plain http is allowed for loopback hosts only, which
 * is how command-line tools receive the redirect.
 */
export function isValidCallbackUrl(value: string): boolean {
	if (value.length > MAX_OAUTH_CALLBACK_URL_CHARS) return false;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.hash || url.username || url.password) return false;
	if (url.protocol === "https:") return url.host !== "";
	if (url.protocol === "http:") {
		return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	}
	return false;
}

/**
 * Whether a state-changing request came from this site. A browser sends an
 * Origin on every cross-site POST, so one that is missing or names another
 * origin is refused: a page on another site cannot submit a consent decision
 * for the signed-in user.
 */
export function isSameOriginRequest(request: Request): boolean {
	const origin = request.headers.get("origin");
	return origin !== null && origin === new URL(request.url).origin;
}

/**
 * The redirect an authorization decision sends the browser to. The base is the
 * app's registered callback URL, never anything the request supplied, so the
 * endpoint cannot be turned into an open redirect. Existing query parameters
 * of the callback are kept.
 */
export function authorizationRedirect(
	callbackUrl: string,
	params: Record<string, string>,
): string {
	const url = new URL(callbackUrl);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}
