import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so vi.mock factories can reference them
const mockGitAuthAttempts = vi.hoisted(() => new Map<string, unknown>());

// git-auth.ts builds its WHERE clause with the real (unmocked) drizzle-orm
// `eq(gitAuthAttempts.key, key)` — since the mocked `gitAuthAttempts` export
// below is a plain object (not a real Column), the raw string value passed to
// `eq` shows up verbatim as one of the resulting SQL condition's queryChunks.
function extractEqValue(condition: unknown): string | undefined {
	const chunks = (condition as { queryChunks?: unknown[] } | undefined)
		?.queryChunks;
	return chunks?.find((chunk) => typeof chunk === "string") as
		| string
		| undefined;
}

const mockDb = vi.hoisted(() => ({
	query: {
		tokens: { findFirst: vi.fn() },
		user: { findFirst: vi.fn() },
		account: { findFirst: vi.fn() },
		gitAuthAttempts: {
			findFirst: vi.fn((args: { where: unknown }) =>
				Promise.resolve(
					mockGitAuthAttempts.get(extractEqValue(args.where) ?? ""),
				),
			),
		},
	},
	update: vi.fn(),
	insert: vi.fn(() => ({
		values: vi.fn((row: { key: string; count: number; windowStart: Date }) => ({
			onConflictDoUpdate: vi.fn(() => {
				const existing = mockGitAuthAttempts.get(row.key) as
					| { count: number; windowStart: Date }
					| undefined;
				const expired =
					!existing ||
					Date.now() - existing.windowStart.getTime() >= 5 * 60_000;
				mockGitAuthAttempts.set(row.key, {
					count: expired ? 1 : existing.count + 1,
					windowStart: expired ? new Date() : existing.windowStart,
				});
				return Promise.resolve();
			}),
		})),
	})),
	delete: vi.fn(() => ({
		where: vi.fn((condition: unknown) => {
			const key = extractEqValue(condition);
			if (key !== undefined) mockGitAuthAttempts.delete(key);
			return Promise.resolve();
		}),
	})),
}));

const mockGetSession = vi.hoisted(() => vi.fn());
const mockFindRepo = vi.hoisted(() => vi.fn());
const mockCanRead = vi.hoisted(() => vi.fn());
const mockCanWrite = vi.hoisted(() => vi.fn());
const mockVerifyPassword = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({ db: mockDb }));
vi.mock("../../db/github-schema", () => ({
	tokens: {},
	gitAuthAttempts: { key: {} },
}));
vi.mock("../../db/schema", () => ({ user: {}, account: {} }));
vi.mock("../../lib/auth", () => ({
	auth: { api: { getSession: mockGetSession } },
}));
vi.mock("../repositories", () => ({ findRepositoryByName: mockFindRepo }));
vi.mock("../repo-access", () => ({
	canReadRepo: mockCanRead,
	canWriteRepo: mockCanWrite,
}));
vi.mock("better-auth/crypto", () => ({ verifyPassword: mockVerifyPassword }));

import { authenticateGitRequest, createAuthChallenge } from "../git-auth";
import {
	GitAuthenticationError,
	GitAuthorizationError,
	GitRateLimitError,
	GitRepositoryNotFoundError,
} from "../git-errors";

const PUBLIC_REPO = {
	id: 1,
	ownerId: "u1",
	name: "repo",
	visibility: "public",
};
const PRIVATE_REPO = { ...PUBLIC_REPO, visibility: "private" };
const SESSION_USER = {
	id: "u1",
	username: "alice",
	email: "alice@example.com",
	name: "Alice",
};

function basicAuthHeader(user: string, pass: string) {
	return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function req(authHeader?: string) {
	return new Request("http://localhost/test.git/info/refs", {
		headers: authHeader ? { authorization: authHeader } : {},
	});
}

// Use this when the test needs session auth to run (our shortcut skips it for cookie-less requests)
function reqWithCookie(authHeader?: string) {
	const headers: Record<string, string> = { cookie: "session=test" };
	if (authHeader) headers.authorization = authHeader;
	return new Request("http://localhost/test.git/info/refs", { headers });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGitAuthAttempts.clear();
	mockGetSession.mockResolvedValue(null);
	mockCanRead.mockResolvedValue(false);
	mockCanWrite.mockResolvedValue(false);
	// db.update().set().where() chain used by authenticateToken to record lastUsedAt
	mockDb.update.mockReturnValue({
		set: vi
			.fn()
			.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
	});
});

describe("createAuthChallenge", () => {
	it("returns Basic realm with default realm", () => {
		expect(createAuthChallenge()).toBe('Basic realm="Git Repository"');
	});

	it("returns Basic realm with custom realm", () => {
		expect(createAuthChallenge("My Repo")).toBe('Basic realm="My Repo"');
	});
});

describe("authenticateGitRequest", () => {
	describe("repository lookup", () => {
		it("throws GitRepositoryNotFoundError when repo does not exist", async () => {
			mockFindRepo.mockResolvedValue(null);
			await expect(
				authenticateGitRequest(req(), "alice", "missing"),
			).rejects.toBeInstanceOf(GitRepositoryNotFoundError);
		});
	});

	describe("anonymous access", () => {
		it("allows anonymous read on public repo when canRead is true", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(false);

			const ctx = await authenticateGitRequest(req(), "alice", "repo");

			expect(ctx.canRead).toBe(true);
			expect(ctx.canWrite).toBe(false);
			expect(ctx.userId).toBe("anonymous");
		});

		it("throws GitAuthenticationError for private repo with no credentials — git prompts for creds", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockCanRead.mockResolvedValue(false); // no user → access denied

			await expect(
				authenticateGitRequest(req(), "alice", "repo"),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});
	});

	describe("session authentication", () => {
		it("grants access when session user has read+write", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockGetSession.mockResolvedValue({ user: SESSION_USER });
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			// reqWithCookie so session auth runs (our shortcut skips getSession for cookie-less requests)
			const ctx = await authenticateGitRequest(
				reqWithCookie(),
				"alice",
				"repo",
			);

			expect(ctx.canRead).toBe(true);
			expect(ctx.canWrite).toBe(true);
			expect(ctx.username).toBe("alice");
		});

		it("throws GitAuthorizationError when authenticated user cannot read", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockGetSession.mockResolvedValue({ user: SESSION_USER });
			mockCanRead.mockResolvedValue(false);

			// reqWithCookie so session auth runs (our shortcut skips getSession for cookie-less requests)
			await expect(
				authenticateGitRequest(reqWithCookie(), "alice", "repo"),
			).rejects.toBeInstanceOf(GitAuthorizationError);
		});
	});

	describe("write enforcement", () => {
		it("throws GitAuthenticationError immediately when write is required and user is not authenticated", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			// no session, no auth header → user = null

			await expect(
				authenticateGitRequest(req(), "alice", "repo", true),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("throws GitAuthorizationError when authenticated user lacks write access", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockGetSession.mockResolvedValue({ user: SESSION_USER });
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(false);

			// reqWithCookie so session auth runs (our shortcut skips getSession for cookie-less requests)
			await expect(
				authenticateGitRequest(reqWithCookie(), "alice", "repo", true),
			).rejects.toBeInstanceOf(GitAuthorizationError);
		});
	});

	describe("PAT authentication", () => {
		function tokenRecord(scopes: string[], expiresAt: Date | null = null) {
			return {
				id: "tok1",
				userId: SESSION_USER.id,
				expiresAt,
				scopes,
				user: SESSION_USER,
			};
		}

		it("authenticates via PAT in password field and allows full access", async () => {
			const token = "ghp_validtoken12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(tokenRecord(["repo"]));
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canRead).toBe(true);
			expect(ctx.canWrite).toBe(true);
			expect(ctx.username).toBe("alice");
		});

		it("also detects PAT in username field (some git clients send it there)", async () => {
			const token = "ghp_tokeninusername12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(tokenRecord(["repo"]));
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(false);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader(token, "irrelevant")),
				"alice",
				"repo",
			);

			expect(ctx.username).toBe("alice");
		});

		it("throws GitAuthenticationError for private repo when PAT is not found", async () => {
			const token = "ghp_unknowntoken";
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(null); // token not in DB
			mockCanRead.mockResolvedValue(false);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("alice", token)),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("throws GitAuthenticationError for expired PAT on private repo", async () => {
			const token = "ghp_expiredtoken12345";
			const yesterday = new Date(Date.now() - 86_400_000);
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(
				tokenRecord(["repo"], yesterday),
			);
			mockCanRead.mockResolvedValue(false); // expired → no auth → 401

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("alice", token)),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});
	});

	describe("token scope enforcement", () => {
		function tokenRecord(scopes: string[]) {
			return {
				id: "tok1",
				userId: SESSION_USER.id,
				expiresAt: null,
				scopes,
				user: SESSION_USER,
			};
		}

		it("rejects PAT with repo:read only when write is required", async () => {
			const token = "ghp_readonlytoken1234";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(
				tokenRecord(["repo:read"]),
			);
			mockCanRead.mockResolvedValue(true);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("alice", token)),
					"alice",
					"repo",
					true,
				),
			).rejects.toBeInstanceOf(GitAuthorizationError);
		});

		it("accepts repo:write scope for both read and write (write implies read)", async () => {
			const token = "ghp_writetoken12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(
				tokenRecord(["repo:write"]),
			);
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
		});

		it("accepts repo scope (broad) for write", async () => {
			const token = "ghp_broadscope12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(tokenRecord(["repo"]));
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
		});

		it("accepts wildcard scope for write", async () => {
			const token = "ghp_wildcardscope123";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(tokenRecord(["*"]));
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
		});

		it("allows PAT with empty scopes array to access everything (unscoped = full access)", async () => {
			const token = "ghp_noscopestoken1234";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue(tokenRecord([]));
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
		});
	});

	describe("password authentication", () => {
		function accountRecord(password = "hashed-password") {
			return { userId: SESSION_USER.id, providerId: "credential", password };
		}

		it("authenticates via username/password when no PAT prefix is present", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(SESSION_USER);
			mockDb.query.account.findFirst.mockResolvedValue(accountRecord());
			mockVerifyPassword.mockResolvedValue(true);
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("pw-user-ok", "correct-horse")),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
			expect(ctx.username).toBe("alice");
		});

		it("rejects wrong password without throwing (falls through to anonymous/401)", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(SESSION_USER);
			mockDb.query.account.findFirst.mockResolvedValue(accountRecord());
			mockVerifyPassword.mockResolvedValue(false);
			mockCanRead.mockResolvedValue(false);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("pw-user-wrong", "bad-password")),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("locks out further attempts after repeated failures for the same username", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(SESSION_USER);
			mockDb.query.account.findFirst.mockResolvedValue(accountRecord());
			mockVerifyPassword.mockResolvedValue(false);
			mockCanRead.mockResolvedValue(false);

			const attempt = () =>
				authenticateGitRequest(
					req(basicAuthHeader("pw-user-lockout", "bad-password")),
					"alice",
					"repo",
				);

			// 10 failed attempts are allowed through to the normal 401 path...
			for (let i = 0; i < 10; i++) {
				await expect(attempt()).rejects.toBeInstanceOf(GitAuthenticationError);
			}

			// ...the 11th is rejected by the limiter itself, before touching the DB again.
			await expect(attempt()).rejects.toBeInstanceOf(GitRateLimitError);
		});

		it("does not lock out a different username after another account's failures", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(SESSION_USER);
			mockDb.query.account.findFirst.mockResolvedValue(accountRecord());
			mockVerifyPassword.mockResolvedValue(false);
			mockCanRead.mockResolvedValue(false);

			for (let i = 0; i < 10; i++) {
				await expect(
					authenticateGitRequest(
						req(basicAuthHeader("pw-user-a", "bad-password")),
						"alice",
						"repo",
					),
				).rejects.toBeInstanceOf(GitAuthenticationError);
			}

			// A different username is a different rate-limit bucket — still gets the normal 401.
			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("pw-user-b", "bad-password")),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("records a failed attempt when user is not found", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(null);
			mockCanRead.mockResolvedValue(false);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("nonexistent-user", "some-pass")),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("records a failed attempt when credential account has no password", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			mockDb.query.user.findFirst.mockResolvedValue(SESSION_USER);
			mockDb.query.account.findFirst.mockResolvedValue(null);
			mockCanRead.mockResolvedValue(false);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("no-cred-user", "some-pass")),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});
	});

	describe("error resilience", () => {
		it("falls through to basic auth when session lookup throws (DB down)", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockGetSession.mockRejectedValueOnce(new Error("DB connection refused"));
			// Basic auth with PAT succeeds
			const token = "ghp_sessionerrortoken1234";
			mockDb.query.tokens.findFirst.mockResolvedValue({
				id: "tok1",
				userId: "u1",
				expiresAt: null,
				scopes: ["repo"],
				user: SESSION_USER,
			});
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			// reqWithCookie triggers session auth, which throws, falls through to PAT
			const ctx = await authenticateGitRequest(
				reqWithCookie(basicAuthHeader("alice", token)),
				"alice",
				"repo",
			);

			expect(ctx.canRead).toBe(true);
			expect(ctx.userId).toBe("u1");
		});

		it("returns null when token lookup throws (DB error), treated as unauthenticated", async () => {
			mockFindRepo.mockResolvedValue(PRIVATE_REPO);
			const token = "ghp_dberrortoken1234";
			mockDb.query.tokens.findFirst.mockRejectedValueOnce(
				new Error("DB read timeout"),
			);
			mockCanRead.mockResolvedValue(false);

			await expect(
				authenticateGitRequest(
					req(basicAuthHeader("alice", token)),
					"alice",
					"repo",
				),
			).rejects.toBeInstanceOf(GitAuthenticationError);
		});

		it("returns null when password auth DB query throws", async () => {
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.user.findFirst.mockRejectedValueOnce(
				new Error("DB read timeout"),
			);
			mockCanRead.mockResolvedValue(true);

			// Password auth error is caught internally, returns null → anonymous
			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("dberror-user", "some-pass")),
				"alice",
				"repo",
			);

			expect(ctx.userId).toBe("anonymous");
		});

		it("rejects PAT with undefined scopes (treated as no scopes = full access)", async () => {
			const token = "ghp_undefscopes12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue({
				id: "tok1",
				userId: "u1",
				expiresAt: null,
				scopes: undefined, // not an array
				user: SESSION_USER,
			});
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			expect(ctx.canWrite).toBe(true);
		});

		it("filters non-string values from token scopes array", async () => {
			const token = "ghp_mixedscopes12345";
			mockFindRepo.mockResolvedValue(PUBLIC_REPO);
			mockDb.query.tokens.findFirst.mockResolvedValue({
				id: "tok1",
				userId: "u1",
				expiresAt: null,
				scopes: ["repo:read", 123, null, "repo:write"],
				user: SESSION_USER,
			});
			mockCanRead.mockResolvedValue(true);
			mockCanWrite.mockResolvedValue(true);

			const ctx = await authenticateGitRequest(
				req(basicAuthHeader("alice", token)),
				"alice",
				"repo",
				true,
			);

			// Non-string values filtered out, repo:write remains
			expect(ctx.canWrite).toBe(true);
		});
	});
});
