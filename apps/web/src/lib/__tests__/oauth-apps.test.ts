import { describe, expect, it } from "vitest";
import {
	authorizationRedirect,
	isSameOriginRequest,
	isValidCallbackUrl,
	newOAuthClientId,
	newOAuthClientSecret,
} from "../oauth-apps";
import { safeInternalPath } from "../safe-redirect";

describe("OAuth app credentials", () => {
	it("issues GitHub-shaped client ids and 40-hex secrets", () => {
		expect(newOAuthClientId()).toMatch(/^Iv1\.[0-9a-f]{16}$/);
		expect(newOAuthClientSecret()).toMatch(/^[0-9a-f]{40}$/);
		expect(newOAuthClientId()).not.toBe(newOAuthClientId());
	});
});

describe("callback URLs", () => {
	it("accepts https, and http only on loopback", () => {
		expect(isValidCallbackUrl("https://example.com/cb")).toBe(true);
		expect(isValidCallbackUrl("http://localhost:8080/cb")).toBe(true);
		expect(isValidCallbackUrl("http://127.0.0.1/cb")).toBe(true);
		expect(isValidCallbackUrl("http://example.com/cb")).toBe(false);
	});

	it("refuses fragments, embedded credentials, other schemes and non-URLs", () => {
		expect(isValidCallbackUrl("https://example.com/cb#x")).toBe(false);
		expect(isValidCallbackUrl("https://user:pw@example.com/cb")).toBe(false);
		expect(isValidCallbackUrl("javascript:alert(1)")).toBe(false);
		expect(isValidCallbackUrl("ftp://example.com/cb")).toBe(false);
		expect(isValidCallbackUrl("example.com/cb")).toBe(false);
		expect(isValidCallbackUrl("")).toBe(false);
	});

	it("refuses a callback past the length cap", () => {
		expect(isValidCallbackUrl(`https://example.com/${"a".repeat(3000)}`)).toBe(
			false,
		);
	});
});

describe("authorization redirects", () => {
	it("keeps the callback's own query and encodes the code and state", () => {
		const url = new URL(
			authorizationRedirect("https://app.example/cb?keep=1", {
				code: "abc",
				state: "a&b=c d",
			}),
		);
		expect(url.origin + url.pathname).toBe("https://app.example/cb");
		expect(url.searchParams.get("keep")).toBe("1");
		expect(url.searchParams.get("code")).toBe("abc");
		expect(url.searchParams.get("state")).toBe("a&b=c d");
	});

	it("treats only a same-origin request as a same-site decision", () => {
		const request = (origin?: string) =>
			new Request("https://git.test/_serverFn/decide", {
				method: "POST",
				headers: origin ? { origin } : {},
			});
		expect(isSameOriginRequest(request("https://git.test"))).toBe(true);
		expect(isSameOriginRequest(request("https://evil.test"))).toBe(false);
		expect(isSameOriginRequest(request("null"))).toBe(false);
		expect(isSameOriginRequest(request())).toBe(false);
	});
});

describe("login return path", () => {
	it("follows only a path on this site", () => {
		expect(safeInternalPath("/login/oauth/authorize?client_id=x")).toBe(
			"/login/oauth/authorize?client_id=x",
		);
		expect(safeInternalPath("https://evil.test/")).toBeNull();
		expect(safeInternalPath("//evil.test/")).toBeNull();
		expect(safeInternalPath("/\\evil.test")).toBeNull();
		expect(safeInternalPath("/x\r\nLocation: y")).toBeNull();
		expect(safeInternalPath("dashboard")).toBeNull();
		expect(safeInternalPath(undefined)).toBeNull();
	});
});
