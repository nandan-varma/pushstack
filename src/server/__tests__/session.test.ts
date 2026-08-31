/**
 * Tests for session.ts: getCurrentUser/getCurrentUserOptional wrap
 * getSession (auth-session.ts) and getCurrentUser must throw when
 * unauthenticated instead of silently returning a nullish user.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth-session", () => ({
	getSession: getSessionMock,
}));

describe("getCurrentUserOptional", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the session user when a session exists", async () => {
		getSessionMock.mockResolvedValueOnce({ user: { id: "u1" } });

		const { getCurrentUserOptional } = await import("../session");
		const result = await getCurrentUserOptional();

		expect(result).toEqual({ id: "u1" });
	});

	it("returns null when there is no session", async () => {
		getSessionMock.mockResolvedValueOnce(null);

		const { getCurrentUserOptional } = await import("../session");
		const result = await getCurrentUserOptional();

		expect(result).toBeNull();
	});

	it("returns null when the session has no user", async () => {
		getSessionMock.mockResolvedValueOnce({ user: null });

		const { getCurrentUserOptional } = await import("../session");
		const result = await getCurrentUserOptional();

		expect(result).toBeNull();
	});
});

describe("getCurrentUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the user when authenticated", async () => {
		getSessionMock.mockResolvedValueOnce({ user: { id: "u1" } });

		const { getCurrentUser } = await import("../session");
		const result = await getCurrentUser();

		expect(result).toEqual({ id: "u1" });
	});

	it("throws Unauthorized when there is no session", async () => {
		getSessionMock.mockResolvedValueOnce(null);

		const { getCurrentUser } = await import("../session");
		await expect(getCurrentUser()).rejects.toThrow("Unauthorized");
	});

	it("throws Unauthorized when the user has no id", async () => {
		getSessionMock.mockResolvedValueOnce({ user: { id: "" } });

		const { getCurrentUser } = await import("../session");
		await expect(getCurrentUser()).rejects.toThrow("Unauthorized");
	});
});
