/**
 * Request authentication for the REST API: `Authorization: token pst_…` or
 * `Bearer pst_…` (GitHub accepts both), resolved by git-auth's token lookup.
 * Cookies are never accepted — a session-authenticated API would let any
 * website act as the visitor.
 */
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
