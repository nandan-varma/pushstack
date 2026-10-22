/**
 * Request authentication for the REST API: `Authorization: token pst_…` or
 * `Bearer pst_…` (GitHub accepts both), resolved by git-auth's token lookup.
 * Cookies are never accepted — a session-authenticated API would let any
 * website act as the visitor.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { TOKEN_PREFIX, type TokenScope, tokenAllows } from "#/lib/token-scopes";
import { authenticateToken } from "../git-auth";
import {
	badCredentialsError,
	insufficientScopeError,
	requiresAuthenticationError,
} from "./http";

export interface Caller {
	userId: string;
	scopes: TokenScope[];
}

export interface ApiContext {
	request: Request;
	url: URL;
	/** Path parameters (`:owner`, `*branch`), decoded. */
	params: Record<string, string>;
	/** null for an anonymous request. */
	caller: Caller | null;
}

/**
 * The caller behind the request's credentials: null when there are none,
 * 401 "Bad credentials" when they are malformed, unknown or expired.
 */
export async function authenticateRequest(
	request: Request,
): Promise<Caller | null> {
	const header = request.headers.get("authorization");
	if (header === null) return null;
	const match = /^(?:token|bearer)\s+(\S+)$/i.exec(header.trim());
	const token = match?.[1];
	if (!token?.startsWith(TOKEN_PREFIX)) throw badCredentialsError();
	const caller = await authenticateToken(token);
	if (!caller) throw badCredentialsError();
	return caller;
}

/**
 * The `X-OAuth-Scopes` value GitHub sends for a classic token, from a PAT's
 * scopes: `repo:write` is GitHub's `repo` (with `read:org`, vacuously true
 * here: there are no organizations to hide). A read-only token has no classic
 * equivalent, so like a GitHub fine-grained token it gets no header (null).
 */
export function oauthScopesHeader(
	scopes: readonly TokenScope[],
): string | null {
	return tokenAllows([...scopes], "repo:write") ? "read:org, repo" : null;
}

/** The caller, or 401 "Requires authentication". */
export function requireCaller({ caller }: ApiContext): Caller {
	if (!caller) throw requiresAuthenticationError();
	return caller;
}

/** The caller, who must hold `scope` (403 otherwise, as GitHub does). */
export function requireScope(ctx: ApiContext, scope: TokenScope): Caller {
	const caller = requireCaller(ctx);
	if (!tokenAllows(caller.scopes, scope)) throw insufficientScopeError();
	return caller;
}

/** The caller's name and email, for the commits a write creates. */
export async function callerIdentity(
	caller: Caller,
): Promise<{ id: string; name: string; email: string }> {
	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, caller.userId))
		.limit(1);
	if (!row) throw new Error("Authenticated user missing");
	return row;
}
