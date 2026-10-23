/**
 * Authentication and authorization for git over HTTP. Git clients
 * authenticate with a personal access token as the Basic-auth password (or
 * username). Passwords and session cookies are deliberately not accepted
 * here: a token is revocable and scoped, and a cookie-authenticated git
 * endpoint would let any website POST a push as the visitor.
 */
import { eq } from "drizzle-orm";
import { GitAuthenticationError, GitAuthorizationError } from "git-fs-s3";
import { db } from "#/db";
import type { Repository } from "#/db/app-schema";
import { tokens } from "#/db/app-schema";
import { base64ToUtf8 } from "#/lib/bytes";
import {
	hashToken,
	TOKEN_PREFIX,
	type TokenScope,
	tokenAllows,
} from "#/lib/token-scopes";
import { ARCHIVED_MESSAGE, getAccessForRepository } from "./repo-access";

export interface GitAccess {
	/** null for an anonymous read of a public repository. */
	userId: string | null;
	canRead: boolean;
	canWrite: boolean;
}

const LAST_USED_RESOLUTION_MS = 60 * 60_000;

function tokenFromRequest(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Basic ")) return null;
	let credentials: string;
	try {
		credentials = base64ToUtf8(header.slice("Basic ".length));
	} catch {
		return null;
	}
	const colon = credentials.indexOf(":");
	const username = colon === -1 ? credentials : credentials.slice(0, colon);
	const password = colon === -1 ? "" : credentials.slice(colon + 1);
	if (password.startsWith(TOKEN_PREFIX)) return password;
	if (username.startsWith(TOKEN_PREFIX)) return username;
	return null;
}

export async function authenticateToken(
	token: string,
): Promise<{ userId: string; scopes: TokenScope[] } | null> {
	const tokenHash = await hashToken(token);
	const found = await db.query.tokens.findFirst({
		where: { tokenHash: tokenHash },
	});
	if (!found || (found.expiresAt && found.expiresAt < new Date())) return null;
	if (
		!found.lastUsedAt ||
		Date.now() - found.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS
	) {
		await db
			.update(tokens)
			.set({ lastUsedAt: new Date() })
			.where(eq(tokens.id, found.id));
	}
	return { userId: found.userId, scopes: found.scopes };
}

/**
 * Authorize one git request against `repo`. Throws GitAuthenticationError
 * (401, so git prompts for credentials) when credentials are missing or
 * invalid and would matter, GitAuthorizationError (403) when they're valid
 * but insufficient.
 */
export async function authorizeGitRequest(
	request: Request,
	repo: Repository,
	needsWrite: boolean,
): Promise<GitAccess> {
	const token = tokenFromRequest(request);
	const hasCredentials = request.headers.has("authorization");
	const user = token ? await authenticateToken(token) : null;
	if (hasCredentials && !user) {
		throw new GitAuthenticationError(
			"Invalid credentials: use a personal access token as the password",
		);
	}

	const access = await getAccessForRepository(repo, user?.userId ?? null);
	const scopes = user?.scopes;
	const canRead =
		access.canRead && (!scopes || tokenAllows(scopes, "repo:read"));
	const canWrite =
		access.canWrite && !!scopes && tokenAllows(scopes, "repo:write");

	if (needsWrite && canRead && access.repository.archived && user) {
		throw new GitAuthorizationError(ARCHIVED_MESSAGE);
	}
	if (!canRead || (needsWrite && !canWrite)) {
		if (!user) {
			throw new GitAuthenticationError("Authentication required");
		}
		throw new GitAuthorizationError(
			needsWrite
				? "Access denied: no write access (or the token lacks repo:write)"
				: "Access denied: no read access",
		);
	}
	return { userId: user?.userId ?? null, canRead, canWrite };
}
