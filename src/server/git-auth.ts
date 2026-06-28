/**
 * Git authentication middleware for HTTP protocol operations
 * Handles HTTP Basic Auth and repository access permissions
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { auth } from "../lib/auth";
import {
	GitAuthenticationError,
	GitAuthorizationError,
	GitRepositoryNotFoundError,
} from "./git-errors";
import { canReadRepo, canWriteRepo } from "./repo-access";
import { findRepositoryByName } from "./repositories";

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
	if (!authHeader || !authHeader.startsWith("Basic ")) {
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
	// Try session authentication first (for web UI)
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
		console.error("[git-auth] session auth error:", err);
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

		if (!foundUser) return null;

		const credAccount = await db.query.account.findFirst({
			where: (a, { and, eq: eqFn }) =>
				and(eqFn(a.userId, foundUser.id), eqFn(a.providerId, "credential")),
		});

		if (!credAccount?.password) return null;

		const valid = await verifyPassword({
			hash: credAccount.password,
			password,
		});

		if (!valid) return null;

		return {
			id: foundUser.id,
			username: foundUser.username,
			email: foundUser.email,
			name: foundUser.name,
		};
	} catch (error) {
		console.error("Password auth error:", error);
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
		console.error("Token auth error:", error);
		return null;
	}
}

/**
 * Authenticate and authorize git operation
 * @param request Request object
 * @param owner Repository owner username
 * @param repoName Repository name (without .git extension)
 * @param requireWrite Whether write access is required (for push operations)
 * @returns GitAuthContext with user, repo, and permissions
 * @throws Error if authentication or authorization fails
 */
export async function authenticateGitRequest(
	request: Request,
	owner: string,
	repoName: string,
	requireWrite: boolean = false,
): Promise<GitAuthContext> {
	// Get repository
	const repo = await findRepositoryByName(owner, repoName);

	if (!repo) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}

	// Authenticate user
	const user = await authenticateUser(request);

	// For write operations, require authentication first
	if (requireWrite && !user) {
		throw new GitAuthenticationError(
			"Authentication required for write access",
		);
	}

	// Check token scopes before hitting the DB for access checks
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

	// Check read permission
	const canRead = await canReadRepo(repo.id, user?.id || null);

	if (!canRead) {
		// Unauthenticated users hitting a private repo get 401 so git prompts for credentials
		if (!user) {
			throw new GitAuthenticationError(
				"Authentication required to access this repository",
			);
		}
		throw new GitAuthorizationError(
			"Access denied: insufficient read permissions",
		);
	}

	// Check write permission if required
	const canWrite = await canWriteRepo(repo.id, user?.id || null);

	if (requireWrite && !canWrite) {
		throw new GitAuthorizationError(
			"Access denied: insufficient write permissions",
		);
	}

	// Return auth context
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
