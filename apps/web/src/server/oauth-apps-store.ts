/**
 * OAuth apps and the authorization-code grant: registering an app, the
 * consent lookup, issuing a code, and the one exchange that turns a code into
 * a token. Like the device flow, every single-use transition is one
 * conditional UPDATE, and the tokens are the same `pst_` tokens as any other.
 */
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "#/db";
import { oauthApps, oauthCodes, tokens } from "#/db/app-schema";
import { bytesToBase64Url, randomBytes, sha256Hex } from "#/lib/bytes";
import type { DeviceFlowError } from "#/lib/device-flow";
import {
	AUTHORIZATION_CODE_LIFETIME_SECONDS,
	newAuthorizationCode,
	newOAuthClientId,
	newOAuthClientSecret,
} from "#/lib/oauth-apps";
import { TOKEN_PREFIX, type TokenScope } from "#/lib/token-scopes";

export interface OAuthAppView {
	id: number;
	name: string;
	callbackUrl: string;
	clientId: string;
	createdAt: Date;
}

/** Creates an app. The secret is returned here and nowhere else, ever again. */
export async function createOAuthApp(input: {
	userId: string;
	name: string;
	callbackUrl: string;
}): Promise<OAuthAppView & { clientSecret: string }> {
	const clientId = newOAuthClientId();
	const clientSecret = newOAuthClientSecret();
	const [row] = await db
		.insert(oauthApps)
		.values({
			userId: input.userId,
			name: input.name,
			callbackUrl: input.callbackUrl,
			clientId,
			clientSecretHash: await sha256Hex(clientSecret),
		})
		.returning({
			id: oauthApps.id,
			createdAt: oauthApps.createdAt,
		});
	if (!row) throw new Error("OAuth app insert returned no row");
	return {
		id: row.id,
		name: input.name,
		callbackUrl: input.callbackUrl,
		clientId,
		createdAt: row.createdAt,
		clientSecret,
	};
}

/** The user's registered apps, newest first. Never includes a secret. */
export function listOAuthApps(userId: string): Promise<OAuthAppView[]> {
	return db
		.select({
			id: oauthApps.id,
			name: oauthApps.name,
			callbackUrl: oauthApps.callbackUrl,
			clientId: oauthApps.clientId,
			createdAt: oauthApps.createdAt,
		})
		.from(oauthApps)
		.where(eq(oauthApps.userId, userId))
		.orderBy(desc(oauthApps.createdAt));
}

/**
 * Deletes an app. Its tokens and pending codes go with it (cascade), so every
 * token the app was issued is revoked at once, as GitHub does.
 */
export async function deleteOAuthApp(input: {
	userId: string;
	id: number;
}): Promise<boolean> {
	const deleted = await db
		.delete(oauthApps)
		.where(and(eq(oauthApps.id, input.id), eq(oauthApps.userId, input.userId)))
		.returning({ id: oauthApps.id });
	return deleted.length > 0;
}

export interface AuthorizedAppView {
	id: number;
	name: string;
	clientId: string;
	scopes: TokenScope[];
	/** When the user first authorized the app. */
	authorizedAt: Date;
}

/**
 * The OAuth apps holding a token for this user, one entry per app. Scopes are
 * the union of its tokens' scopes; the date is the earliest token's.
 */
export async function listAuthorizedApps(
	userId: string,
): Promise<AuthorizedAppView[]> {
	const rows = await db
		.select({
			id: oauthApps.id,
			name: oauthApps.name,
			clientId: oauthApps.clientId,
			scopes: tokens.scopes,
			createdAt: tokens.createdAt,
		})
		.from(tokens)
		.innerJoin(oauthApps, eq(tokens.oauthAppId, oauthApps.id))
		.where(eq(tokens.userId, userId))
		.orderBy(tokens.createdAt);
	const byApp = new Map<number, AuthorizedAppView>();
	for (const row of rows) {
		const existing = byApp.get(row.id);
		if (existing) {
			for (const scope of row.scopes) {
				if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
			}
		} else {
			byApp.set(row.id, {
				id: row.id,
				name: row.name,
				clientId: row.clientId,
				scopes: [...row.scopes],
				authorizedAt: row.createdAt,
			});
		}
	}
	return [...byApp.values()];
}

/** Revokes every token the user holds through one app. Returns how many. */
export async function revokeAuthorizedApp(input: {
	userId: string;
	appId: number;
}): Promise<number> {
	const revoked = await db
		.delete(tokens)
		.where(
			and(eq(tokens.userId, input.userId), eq(tokens.oauthAppId, input.appId)),
		)
		.returning({ id: tokens.id });
	return revoked.length;
}

export interface AuthorizationApp {
	id: number;
	name: string;
	clientId: string;
	callbackUrl: string;
}

/**
 * The app an authorization request names, or why it cannot proceed. The
 * redirect URI must equal the registered callback exactly: a request that
 * names any other URI is refused, and the user is never sent there.
 */
export async function findAuthorizationApp(input: {
	clientId: string;
	redirectUri: string;
}): Promise<
	| { ok: true; app: AuthorizationApp }
	| { ok: false; error: "unknown_client" | "redirect_uri_mismatch" }
> {
	const row = await db.query.oauthApps.findFirst({
		where: { clientId: input.clientId },
	});
	if (!row) return { ok: false, error: "unknown_client" };
	if (row.callbackUrl !== input.redirectUri) {
		return { ok: false, error: "redirect_uri_mismatch" };
	}
	return {
		ok: true,
		app: {
			id: row.id,
			name: row.name,
			clientId: row.clientId,
			callbackUrl: row.callbackUrl,
		},
	};
}

/** A SHA-256-shaped value no client secret hashes to; compared for unknown clients. */
const UNKNOWN_CLIENT_DIGEST = "0".repeat(64);

/** Issues a code for the user's approval. Only its SHA-256 is stored. */
export async function issueAuthorizationCode(input: {
	appId: number;
	userId: string;
	redirectUri: string;
	scopes: TokenScope[];
}): Promise<string> {
	// Expired codes can never be exchanged: drop them so the table stays bounded,
	// as the device flow does for its codes.
	await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date()));
	const code = newAuthorizationCode();
	await db.insert(oauthCodes).values({
		codeHash: await sha256Hex(code),
		appId: input.appId,
		userId: input.userId,
		redirectUri: input.redirectUri,
		scopes: [...new Set(input.scopes)],
		expiresAt: new Date(
			Date.now() + AUTHORIZATION_CODE_LIFETIME_SECONDS * 1000,
		),
	});
	return code;
}

export type CodeExchangeOutcome =
	| { ok: true; accessToken: string; scopes: TokenScope[] }
	| { ok: false; error: DeviceFlowError };

/** Compares two equal-length hex digests without leaking where they differ. */
export function safeEqualHex(left: string, right: string): boolean {
	const a = Buffer.from(left, "utf8");
	const b = Buffer.from(right, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Exchanges a code for a token. The client secret is checked first, against
 * its stored hash in constant time, and the code's client and redirect URI
 * must match what it was issued for. Only then is the code consumed, by one
 * conditional UPDATE, so a code yields one token however often it is replayed.
 */
export async function exchangeAuthorizationCode(input: {
	clientId: string;
	clientSecret: string;
	code: string;
	redirectUri: string;
}): Promise<CodeExchangeOutcome> {
	const app = await db.query.oauthApps.findFirst({
		where: { clientId: input.clientId },
	});
	// The presented secret is hashed and compared even when the client id is
	// unknown, against a dummy digest, so the response time does not reveal
	// which client ids exist.
	const presented = await sha256Hex(input.clientSecret);
	const matches = safeEqualHex(
		presented,
		app?.clientSecretHash ?? UNKNOWN_CLIENT_DIGEST,
	);
	if (!app || !matches) {
		return { ok: false, error: "incorrect_client_credentials" };
	}

	const codeHash = await sha256Hex(input.code);
	const row = await db.query.oauthCodes.findFirst({
		where: { codeHash },
	});
	if (
		!row ||
		row.appId !== app.id ||
		row.consumedAt ||
		row.expiresAt <= new Date()
	) {
		return { ok: false, error: "bad_verification_code" };
	}
	// As GitHub: the redirect_uri may be omitted, but when sent it must match.
	if (input.redirectUri !== "" && row.redirectUri !== input.redirectUri) {
		return { ok: false, error: "redirect_uri_mismatch" };
	}

	const [consumed] = await db
		.update(oauthCodes)
		.set({ consumedAt: sql`now()` })
		.where(
			and(
				eq(oauthCodes.codeHash, codeHash),
				isNull(oauthCodes.consumedAt),
				gt(oauthCodes.expiresAt, sql`now()`),
			),
		)
		.returning({ userId: oauthCodes.userId, scopes: oauthCodes.scopes });
	if (!consumed) return { ok: false, error: "bad_verification_code" };

	const accessToken = `${TOKEN_PREFIX}${bytesToBase64Url(randomBytes(30))}`;
	await db.insert(tokens).values({
		userId: consumed.userId,
		name: app.name,
		tokenHash: await sha256Hex(accessToken),
		scopes: consumed.scopes,
		oauthAppId: app.id,
		expiresAt: null,
	});
	return { ok: true, accessToken, scopes: consumed.scopes };
}
