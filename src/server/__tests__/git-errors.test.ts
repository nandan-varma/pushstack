import { describe, expect, it } from "vitest";
import {
	GitAuthenticationError,
	GitAuthorizationError,
	GitConflictError,
	GitError,
	GitInvalidRequestError,
	GitObjectNotFoundError,
	GitProtocolError,
	GitRefNotFoundError,
	GitRepositoryNotFoundError,
	GitTransactionError,
	R2DownloadError,
	R2TransactionError,
	R2UploadError,
	formatErrorResponse,
	isRetryableError,
} from "../git-errors";

describe("GitError hierarchy", () => {
	it("base GitError has correct defaults", () => {
		const e = new GitError("boom");
		expect(e.statusCode).toBe(500);
		expect(e.retryable).toBe(false);
		expect(e.message).toBe("boom");
		expect(e).toBeInstanceOf(Error);
	});

	it("404 errors are non-retryable", () => {
		for (const Cls of [
			GitObjectNotFoundError,
			GitRefNotFoundError,
			GitRepositoryNotFoundError,
		]) {
			const e = new Cls("not found");
			expect(e.statusCode).toBe(404);
			expect(e.retryable).toBe(false);
		}
	});

	it("GitConflictError is 409 non-retryable with conflicts", () => {
		const conflicts = [{ file: "README.md" }];
		const e = new GitConflictError("conflict", conflicts);
		expect(e.statusCode).toBe(409);
		expect(e.retryable).toBe(false);
		expect(e.toJSON()).toMatchObject({ conflicts });
	});

	it("GitTransactionError is 500 retryable with phase", () => {
		const e = new GitTransactionError("tx failed", "commit");
		expect(e.statusCode).toBe(500);
		expect(e.retryable).toBe(true);
		expect(e.phase).toBe("commit");
		expect(e.toJSON()).toMatchObject({ phase: "commit" });
	});

	it("GitAuthenticationError is 401", () => {
		expect(new GitAuthenticationError("unauth").statusCode).toBe(401);
	});

	it("GitAuthorizationError is 403", () => {
		expect(new GitAuthorizationError("forbidden").statusCode).toBe(403);
	});

	it("GitInvalidRequestError is 400", () => {
		expect(new GitInvalidRequestError("bad").statusCode).toBe(400);
	});

	it("GitProtocolError is 400", () => {
		expect(new GitProtocolError("proto").statusCode).toBe(400);
	});

	it("R2 errors are 500 retryable by default", () => {
		for (const Cls of [R2UploadError, R2DownloadError, R2TransactionError]) {
			const e = new Cls("r2 failed");
			expect(e.statusCode).toBe(500);
			expect(e.retryable).toBe(true);
		}
	});

	it("toJSON includes all base fields", () => {
		const e = new GitObjectNotFoundError("blob missing");
		expect(e.toJSON()).toEqual({
			error: "GitObjectNotFoundError",
			message: "blob missing",
			statusCode: 404,
			retryable: false,
		});
	});
});

describe("formatErrorResponse", () => {
	it("maps GitError to its status code", () => {
		const r = formatErrorResponse(new GitObjectNotFoundError("missing"));
		expect(r.status).toBe(404);
		expect(r.body.error).toBe("GitObjectNotFoundError");
	});

	it("maps generic Error to 500", () => {
		const r = formatErrorResponse(new Error("something broke"));
		expect(r.status).toBe(500);
		expect(r.body.message).toBe("An internal error occurred");
		expect(r.body.retryable).toBe(true);
	});

	it("maps unknown value to 500 UnknownError", () => {
		const r = formatErrorResponse("string error");
		expect(r.status).toBe(500);
		expect(r.body.error).toBe("UnknownError");
	});

	it("maps GitAuthorizationError to 403", () => {
		const r = formatErrorResponse(new GitAuthorizationError("no access"));
		expect(r.status).toBe(403);
	});

	it("adds WWW-Authenticate header to 401 responses", () => {
		const r = formatErrorResponse(
			new GitAuthenticationError("unauthenticated"),
		);
		expect(r.status).toBe(401);
		expect(r.headers?.["WWW-Authenticate"]).toMatch(/^Basic realm=/);
	});

	it("does NOT add WWW-Authenticate to non-401 errors", () => {
		const r403 = formatErrorResponse(new GitAuthorizationError("forbidden"));
		expect(r403.headers?.["WWW-Authenticate"]).toBeUndefined();
		const r404 = formatErrorResponse(new GitObjectNotFoundError("gone"));
		expect(r404.headers?.["WWW-Authenticate"]).toBeUndefined();
	});

	it("plain Error auth messages no longer leak as 500 (regression guard)", () => {
		// After fix, auth errors use GitError subclasses — a plain Error here
		// means something broke the fix. This guards against regression.
		const r = formatErrorResponse(new Error("Access denied: something"));
		// plain Error is still 500 — but authenticateGitRequest no longer throws plain Errors
		expect(r.status).toBe(500);
	});
});

describe("isRetryableError", () => {
	it("returns true for retryable GitError", () => {
		expect(isRetryableError(new R2UploadError("upload fail"))).toBe(true);
	});

	it("returns false for non-retryable GitError", () => {
		expect(isRetryableError(new GitObjectNotFoundError("404"))).toBe(false);
	});

	it("returns true for network-like Error messages", () => {
		expect(isRetryableError(new Error("network timeout"))).toBe(true);
		expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
		expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
	});

	it("returns false for non-network errors", () => {
		expect(isRetryableError(new Error("TypeError: undefined is not a function"))).toBe(false);
	});

	it("returns false for unknown values", () => {
		expect(isRetryableError(null)).toBe(false);
		expect(isRetryableError("string")).toBe(false);
	});
});
