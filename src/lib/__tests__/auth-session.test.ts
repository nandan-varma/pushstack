/**
 * Tests for auth-session.ts's getSession: the per-cookie single-flight
 * coalescing that lets several server functions in one page load share a
 * single Better Auth session validation instead of each doing their own.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupServerFnMock } from "@/test/server-test-utils";

setupServerFnMock();

let currentCookie = "session=abc";
vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers({ cookie: currentCookie }),
}));

const getSessionApiMock = vi.fn();
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: getSessionApiMock } },
}));

describe("getSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		currentCookie = "session=abc";
	});

	it("returns the resolved session", async () => {
		getSessionApiMock.mockResolvedValueOnce({ user: { id: "u1" } });

		const { getSession } = await import("../auth-session");
		const result = await getSession();

		expect(result).toEqual({ user: { id: "u1" } });
	});

	it("skips Better Auth entirely when the request has no cookies", async () => {
		currentCookie = "";

		const { getSession } = await import("../auth-session");
		await expect(getSession()).resolves.toBeNull();
		expect(getSessionApiMock).not.toHaveBeenCalled();
	});

	it("coalesces concurrent calls with the same cookie into one auth.api.getSession call", async () => {
		let resolveSession: (v: unknown) => void = () => {};
		getSessionApiMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSession = resolve;
			}),
		);

		const { getSession } = await import("../auth-session");
		const p1 = getSession();

		// getSession only registers the in-flight promise after its dynamic
		// `await import("@/lib/auth")` resolves, so wait for the first call to
		// actually reach auth.api.getSession before firing the second — this is
		// the coalescing window the comment in auth-session.ts describes
		// (concurrent calls *while one is pending*), not two calls issued in
		// the exact same synchronous tick.
		await vi.waitFor(() => expect(getSessionApiMock).toHaveBeenCalled());

		const p2 = getSession();
		expect(getSessionApiMock).toHaveBeenCalledTimes(1);

		resolveSession({ user: { id: "u1" } });
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(r1).toEqual({ user: { id: "u1" } });
		expect(r2).toEqual({ user: { id: "u1" } });
	});

	it("does not coalesce calls with different cookies", async () => {
		getSessionApiMock
			.mockResolvedValueOnce({ user: { id: "u1" } })
			.mockResolvedValueOnce({ user: { id: "u2" } });

		const { getSession } = await import("../auth-session");

		currentCookie = "session=first";
		const r1 = await getSession();

		currentCookie = "session=second";
		const r2 = await getSession();

		expect(getSessionApiMock).toHaveBeenCalledTimes(2);
		expect(r1).toEqual({ user: { id: "u1" } });
		expect(r2).toEqual({ user: { id: "u2" } });
	});

	it("issues a fresh call for the same cookie once the in-flight one has settled", async () => {
		getSessionApiMock
			.mockResolvedValueOnce({ user: { id: "u1" } })
			.mockResolvedValueOnce({ user: { id: "u1-again" } });

		const { getSession } = await import("../auth-session");

		const r1 = await getSession();
		const r2 = await getSession();

		expect(getSessionApiMock).toHaveBeenCalledTimes(2);
		expect(r1).toEqual({ user: { id: "u1" } });
		expect(r2).toEqual({ user: { id: "u1-again" } });
	});

	it("clears the in-flight entry even when auth.api.getSession rejects", async () => {
		getSessionApiMock
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce({ user: { id: "u1" } });

		const { getSession } = await import("../auth-session");

		await expect(getSession()).rejects.toThrow("boom");

		const result = await getSession();
		expect(result).toEqual({ user: { id: "u1" } });
		expect(getSessionApiMock).toHaveBeenCalledTimes(2);
	});
});
