import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth-session", () => ({ getSession: getSessionMock }));

const { getCurrentUser, getCurrentUserOptional } = await import("../session");

describe("session", () => {
	beforeEach(() => getSessionMock.mockReset());

	it("returns the signed-in user, username typed as present", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", username: "alice" } });
		await expect(getCurrentUserOptional()).resolves.toEqual({
			id: "u1",
			username: "alice",
		});
		await expect(getCurrentUser()).resolves.toMatchObject({
			username: "alice",
		});
	});

	it("is null / Unauthorized without a session", async () => {
		getSessionMock.mockResolvedValue(null);
		await expect(getCurrentUserOptional()).resolves.toBeNull();
		await expect(getCurrentUser()).rejects.toThrow("Unauthorized");
	});

	it("refuses a user without a username (sign-up requires one)", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", username: null } });
		await expect(getCurrentUserOptional()).rejects.toThrow(/no username/);
	});
});
