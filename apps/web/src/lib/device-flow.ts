/**
 * The OAuth device flow behind `gh auth login`, as pure helpers: the codes it
 * hands out, the scope mapping, and GitHub's wire shapes. Storage and the
 * polling state machine live in server/device-flow-store.ts.
 */
import { randomBytes } from "./bytes";
import type { TokenScope } from "./token-scopes";

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
export const DEVICE_CODE_LIFETIME_SECONDS = 900;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
/** RFC 8628: each slow_down adds this many seconds to the interval. */
export const SLOW_DOWN_STEP_SECONDS = 5;

export type DeviceCodeStatus = "pending" | "approved" | "denied";

/** Error codes of GitHub's device-flow token endpoint, verbatim. */
export type DeviceFlowError =
	| "authorization_pending"
	| "slow_down"
	| "expired_token"
	| "access_denied"
	| "incorrect_device_code"
	| "incorrect_client_credentials"
	| "unsupported_grant_type";

/** Consonants only, as GitHub uses, so a user code never spells a word. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

/** 40 hex characters, the length of GitHub's device codes. */
export function newDeviceCode(): string {
	return Array.from(randomBytes(20), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** `XXXX-XXXX`, drawn without modulo bias (bytes >= 240 are redrawn). */
export function newUserCode(): string {
	const chars: string[] = [];
	const limit = 256 - (256 % USER_CODE_ALPHABET.length);
	while (chars.length < USER_CODE_LENGTH) {
		for (const byte of randomBytes(16)) {
			if (byte >= limit || chars.length === USER_CODE_LENGTH) continue;
			chars.push(USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length] ?? "");
		}
	}
	return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * The canonical `XXXX-XXXX` form of a user code typed by a person (any case,
 * with or without the hyphen or spaces), or null when it cannot be one.
 */
export function canonicalUserCode(input: string): string | null {
	const compact = input.replace(/[\s-]/g, "").toUpperCase();
	if (compact.length !== USER_CODE_LENGTH) return null;
	for (const char of compact) {
		if (!USER_CODE_ALPHABET.includes(char)) return null;
	}
	return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/**
 * GitHub scope names (space or comma separated, as gh sends them) mapped to
 * our token scopes. Only `repo` maps: it is the one scope a git client needs.
 * Other names (`read:org`, `gist`, `workflow`) grant nothing here and are
 * dropped, so a token asking for them still works for git.
 */
export function tokenScopesFromGitHub(scope: string): TokenScope[] {
	const names = new Set(scope.split(/[\s,]+/).filter(Boolean));
	return names.has("repo") ? ["repo:write"] : [];
}

/** The GitHub scope names a token's scopes are echoed as in `scope`. */
export function gitHubScopeNames(scopes: readonly TokenScope[]): string[] {
	return scopes.includes("repo:write") ? ["repo"] : [];
}

/**
 * GitHub answers the device endpoints as a form body, or as JSON when the
 * client sends `Accept: application/json` (gh does).
 */
export function oauthResponse(
	body: Record<string, string | number>,
	accept: string | null,
	status = 200,
): Response {
	if (accept?.includes("application/json")) {
		return Response.json(body, { status });
	}
	const form = new URLSearchParams(
		Object.entries(body).map(([key, value]) => [key, String(value)]),
	);
	return new Response(form.toString(), {
		status,
		headers: { "content-type": "application/x-www-form-urlencoded" },
	});
}

const ERROR_DESCRIPTIONS: Record<DeviceFlowError, string> = {
	authorization_pending:
		"The authorization request is still pending. Keep polling until the user approves it.",
	slow_down:
		"You are polling too fast. Wait for the new interval before polling again.",
	expired_token: "The device code has expired. Start the login again.",
	access_denied: "The authorization request was denied.",
	incorrect_device_code: "The device_code provided is not valid.",
	incorrect_client_credentials:
		"The client_id and device_code do not match, or the client_id is missing.",
	unsupported_grant_type:
		"The grant_type must be urn:ietf:params:oauth:grant-type:device_code.",
};

/** A device-flow error body, shaped like GitHub's (their status is 200). */
export function deviceFlowError(
	error: DeviceFlowError,
	accept: string | null,
	extra: Record<string, number> = {},
): Response {
	return oauthResponse(
		{
			error,
			error_description: ERROR_DESCRIPTIONS[error],
			error_uri:
				"https://docs.github.com/developers/apps/building-oauth-apps/authorizing-oauth-apps#error-codes-for-the-device-flow",
			...extra,
		},
		accept,
	);
}

/** The parameters of a form or JSON request body, as GitHub reads them. */
export async function readRequestParams(
	request: Request,
): Promise<URLSearchParams> {
	const text = await request.text();
	if (request.headers.get("content-type")?.includes("application/json")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return new URLSearchParams();
		}
		const params = new URLSearchParams();
		if (parsed && typeof parsed === "object") {
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string" || typeof value === "number") {
					params.set(key, String(value));
				}
			}
		}
		return params;
	}
	return new URLSearchParams(text);
}
