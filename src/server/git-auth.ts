/**
 * Git authentication middleware for HTTP protocol operations
 * Handles HTTP Basic Auth and repository access permissions
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { gitAuthAttempts } from "../db/github-schema";
import { auth } from "../lib/auth";
import {
	GitAuthenticationError,
	GitAuthorizationError,
	GitRateLimitError,
	GitRepositoryNotFoundError,
} from "./git-errors";
import { logError } from "./perf-log";
import { canReadRepo, canWriteRepo } from "./repo-access";
import { findRepositoryByName } from "./repositories";

// authenticateWithPassword verifies credentials directly against the DB,
// entirely bypassing Better Auth's own rate limiter (which only wraps
// requests routed through auth.handler, i.e. /api/auth/*) — without this,
// the git HTTP endpoint is an unthrottled password-guessing oracle against
// any user's account. Keyed by the attempted username/email (case-
// insensitive) rather than IP, since the thing being protected is a specific
// account, and git/HTTP clients behind NAT or CI shouldn't share a lockout.
// Only failed attempts count against the limit — a legitimate client
// re-authenticating successfully many times (e.g. frequent CI fetches) never
// trips it.
//
// Backed by the git_auth_attempts table (not an in-memory Map): the git HTTP
// endpoint can be served by multiple concurrent, or frequently cold-starting,
// serverless instances, each with its own process memory — a Map on any one
// of them never sees the full set of failed attempts, so the lockout could be
// bypassed for free just by distributing attempts across instances/restarts.
const PASSWORD_AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const PASSWORD_AUTH_RATE_LIMIT_MAX_ATTEMPTS = 10;

async function isPasswordAuthLockedOut(key: string): Promise<boolean> {
	const entry = await db.query.gitAuthAttempts.findFirst({
		where: eq(gitAuthAttempts.key, key),
	});
	if (!entry) return false;
	if (
		Date.now() - entry.windowStart.getTime() >=
		PASSWORD_AUTH_RATE_LIMIT_WINDOW_MS
	) {
		return false;
	}
	return entry.count >= PASSWORD_AUTH_RATE_LIMIT_MAX_ATTEMPTS;
}

// Single upsert, not a read-then-write: the CASE expressions atomically
// decide "still within the current window, so increment" vs. "window
// expired, so reset to 1" inside the same statement Postgres evaluates the
// conflict against, so two concurrent failed attempts for the same key can't
// race each other into under-counting.
async function recordFailedPasswordAttempt(key: string): Promise<void> {
	const windowSeconds = PASSWORD_AUTH_RATE_LIMIT_WINDOW_MS / 1000;
	await db
		.insert(gitAuthAttempts)
		.values({ key, count: 1, windowStart: new Date() })
		.onConflictDoUpdate({
			target: gitAuthAttempts.key,
			set: {
				count: sql`case when ${gitAuthAttempts.windowStart} <= now() - make_interval(secs => ${windowSeconds}) then 1 else ${gitAuthAttempts.count} + 1 end`,
				windowStart: sql`case when ${gitAuthAttempts.windowStart} <= now() - make_interval(secs => ${windowSeconds}) then now() else ${gitAuthAttempts.windowStart} end`,
			},
		});
}

async function clearPasswordAuthAttempts(key: string): Promise<void> {
	await db.delete(gitAuthAttempts).where(eq(gitAuthAttempts.key, key));
}

export interface GitAuthContext {
	userId: string;
	username: string;
	user: {
		id: string;
		username: string | null;
		email: string;
		name: string | null;
	};
	repo: {
		id: number;
		ownerId: string;
		name: string;
		visibility: "public" | "private";
	};
	canRead: boolean;
	canWrite: boolean;
}

type AuthenticatedGitUser = GitAuthContext["user"] & {
	tokenScopes?: string[];
};

function isPersonalAccessToken(value: string): boolean {
	return value.startsWith("ghp_");
}

function hasRequiredTokenScope(
	scopes: string[] | undefined,
	requiredScope: "repo:read" | "repo:write",
): boolean {
	if (!scopes || scopes.length === 0) {
		return true;
	}

	if (scopes.includes("repo") || scopes.includes("*")) {
		return true;
	}

	if (requiredScope === "repo:read" && scopes.includes("repo:write")) {
		return true;
	}

	return scopes.includes(requiredScope);
}

/**
 * Parse HTTP Basic Auth header
 * @param authHeader Authorization header value
 * @returns Object with username and password, or null
 */
function parseBasicAuth(
	authHeader: string | null,
): { username: string; password: string } | null {
	if (!authHeader?.startsWith("Basic ")) {
		return null;
	}

	try {
		const base64Credentials = authHeader.slice(6);
		const credentials = Buffer.from(base64Credentials, "base64").toString(
			"utf-8",
		);
		const colonIdx = credentials.indexOf(":");
		if (colonIdx === -1) return null;
		const username = credentials.slice(0, colonIdx);
		const password = credentials.slice(colonIdx + 1);

		if (!username || !password) {
			return null;
		}

		return { username, password };
	} catch {
		return null;
	}
}

/**
 * Authenticate user via Better Auth session or HTTP Basic Auth
 * @param request Request object with headers
 * @returns User object or null if authentication fails
 */
async function authenticateUser(
	request: Request,
): Promise<AuthenticatedGitUser | null> {
	// git CLI never sends cookies — skip the session DB call for requests without them
	if (request.headers.has("cookie")) {
		try {
			const session = await auth.api.getSession({
				headers: request.headers,
			});

			if (session?.user) {
				return {
					id: session.user.id,
					username: session.user.username || null,
					email: session.user.email,
					name: session.user.name || null,
				};
			}
		} catch (err) {
			// Unexpected error (DB down, misconfiguration) — log it so it's not invisible
			logError("git-auth", "session auth error", err);
		}
	}

	// Try HTTP Basic Auth (for git CLI)
	const authHeader = request.headers.get("authorization");
	const credentials = parseBasicAuth(authHeader);

	if (!credentials) {
		return null;
	}

	// Git clients normally send PATs in the password slot, but keep username fallback for compatibility.
	if (isPersonalAccessToken(credentials.password)) {
		return await authenticateToken(credentials.password);
	}

	if (isPersonalAccessToken(credentials.username)) {
		return await authenticateToken(credentials.username);
	}

	// Fall back to username/password authentication
	return await authenticateWithPassword(
		credentials.username,
		credentials.password,
	);
}

async function authenticateWithPassword(
	usernameOrEmail: string,
	password: string,
): Promise<AuthenticatedGitUser | null> {
	const rateLimitKey = usernameOrEmail.trim().toLowerCase();

	if (await isPasswordAuthLockedOut(rateLimitKey)) {
		throw new GitRateLimitError(
			"Too many failed authentication attempts for this account. Try again later, or use a Personal Access Token instead of a password.",
		);
	}

	try {
		const { user } = await import("../db/schema");
		const { or, eq } = await import("drizzle-orm");
		const { verifyPassword } = await import("better-auth/crypto");

		const foundUser = await db.query.user.findFirst({
			where: or(
				eq(user.username, usernameOrEmail),
				eq(user.email, usernameOrEmail),
			),
		});

		if (!foundUser) {
			await recordFailedPasswordAttempt(rateLimitKey);
			return null;
		}

		const credAccount = await db.query.account.findFirst({
			where: (a, { and, eq: eqFn }) =>
				and(eqFn(a.userId, foundUser.id), eqFn(a.providerId, "credential")),
		});

		if (!credAccount?.password) {
			await recordFailedPasswordAttempt(rateLimitKey);
			return null;
		}

		const valid = await verifyPassword({
			hash: credAccount.password,
			password,
		});

		if (!valid) {
			await recordFailedPasswordAttempt(rateLimitKey);
			return null;
		}

		await clearPasswordAuthAttempts(rateLimitKey);

		return {
			id: foundUser.id,
			username: foundUser.username,
			email: foundUser.email,
			name: foundUser.name,
		};
	} catch (error) {
		logError("git-auth", "Password auth error", error);
		return null;
	}
}

/**
 * Authenticate user via Personal Access Token
 * @param token PAT string (starts with 'ghp_')
 * @returns User object or null if token is invalid
 */
async function authenticateToken(
	token: string,
): Promise<AuthenticatedGitUser | null> {
	try {
		// Hash the token for lookup
		const crypto = await import("node:crypto");
		const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

		// Look up token in database
		const { tokens } = await import("../db/github-schema");
		const foundToken = await db.query.tokens.findFirst({
			where: eq(tokens.tokenHash, tokenHash),
			with: {
				user: true,
			},
		});

		if (!foundToken) {
			return null;
		}

		// Check if token is expired
		if (foundToken.expiresAt && new Date(foundToken.expiresAt) < new Date()) {
			return null;
		}

		// Update last used timestamp
		await db
			.update(tokens)
			.set({ lastUsedAt: new Date() })
			.where(eq(tokens.id, foundToken.id));

		return {
			id: foundToken.userId,
			username: foundToken.user.username,
			email: foundToken.user.email,
			name: foundToken.user.name,
			tokenScopes: Array.isArray(foundToken.scopes)
				? foundToken.scopes.filter(
						(scope): scope is string => typeof scope === "string",
					)
				: [],
		};
	} catch (error) {
		logError("git-auth", "Token auth error", error);
		return null;
	}
}

/**
 * Authenticate and authorize git operation.
 * Pass preloadedRepo (already fetched by the route handler) to avoid a duplicate DB lookup.
 */
export async function authenticateGitRequest(
	request: Request,
	owner: string,
	repoName: string,
	requireWrite: boolean = false,
	preloadedRepo?: Awaited<ReturnType<typeof findRepositoryByName>>,
): Promise<GitAuthContext> {
	const repo = preloadedRepo ?? (await findRepositoryByName(owner, repoName));

	if (!repo) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}

	const user = await authenticateUser(request);

	if (requireWrite && !user) {
		throw new GitAuthenticationError(
			"Authentication required for write access",
		);
	}

	if (user?.tokenScopes) {
		if (!hasRequiredTokenScope(user.tokenScopes, "repo:read")) {
			throw new GitAuthorizationError(
				"Access denied: token lacks repo:read scope",
			);
		}
		if (
			requireWrite &&
			!hasRequiredTokenScope(user.tokenScopes, "repo:write")
		) {
			throw new GitAuthorizationError(
				"Access denied: token lacks repo:write scope",
			);
		}
	}

	const isPublic = repo.visibility === "public";

	// Public repo + anonymous: skip all DB access checks (no write ever, reads always allowed)
	const canRead =
		isPublic && !user ? true : await canReadRepo(repo.id, user?.id ?? null);

	if (!canRead) {
		if (!user) {
			throw new GitAuthenticationError(
				"Authentication required to access this repository",
			);
		}
		throw new GitAuthorizationError(
			"Access denied: insufficient read permissions",
		);
	}

	// Anonymous users can never write; skip the DB call for them
	const canWrite = !user ? false : await canWriteRepo(repo.id, user.id);

	if (requireWrite && !canWrite) {
		throw new GitAuthorizationError(
			"Access denied: insufficient write permissions",
		);
	}

	return {
		userId: user?.id || "anonymous",
		username: user?.username || "anonymous",
		user: user || {
			id: "anonymous",
			username: null,
			email: "anonymous@localhost",
			name: null,
		},
		repo: {
			id: repo.id,
			ownerId: repo.ownerId,
			name: repo.name,
			visibility: repo.visibility as "public" | "private",
		},
		canRead,
		canWrite,
	};
}

/**
 * Create WWW-Authenticate header for 401 responses
 * @param realm Authentication realm
 * @returns WWW-Authenticate header value
 */
export function createAuthChallenge(realm: string = "Git Repository"): string {
	return `Basic realm="${realm}"`;
}
