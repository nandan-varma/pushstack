import { describe, expect, it } from "vitest";
import {
	canonicalUserCode,
	gitHubScopeNames,
	newDeviceCode,
	newUserCode,
	oauthResponse,
	RequestBodyTooLargeError,
	readRequestParams,
	tokenScopesFromGitHub,
} from "../device-flow";
import { MAX_DEVICE_REQUEST_BYTES } from "../limits";

describe("device codes", () => {
	it("issues 40-hex device codes and XXXX-XXXX user codes from the consonant alphabet", () => {
		expect(newDeviceCode()).toMatch(/^[0-9a-f]{40}$/);
		for (let i = 0; i < 50; i++) {
			expect(newUserCode()).toMatch(
				/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
			);
		}
	});

	it("canonicalizes a typed user code and rejects anything else", () => {
		expect(canonicalUserCode("bcdf mglx")).toBe("BCDF-MGLX");
		expect(canonicalUserCode("BCDF-MGLX")).toBe("BCDF-MGLX");
		expect(canonicalUserCode("BCDF-MGLA")).toBeNull();
		expect(canonicalUserCode("BCDF-MGL")).toBeNull();
		expect(canonicalUserCode("")).toBeNull();
	});
});

describe("scopes", () => {
	it("maps GitHub's repo scope to repo:write and drops scopes with no equivalent", () => {
		expect(tokenScopesFromGitHub("repo read:org gist")).toEqual(["repo:write"]);
		expect(tokenScopesFromGitHub("repo,workflow")).toEqual(["repo:write"]);
		expect(tokenScopesFromGitHub("read:org gist")).toEqual([]);
		expect(tokenScopesFromGitHub("")).toEqual([]);
	});

	it("echoes repo:write as the GitHub name repo", () => {
		expect(gitHubScopeNames(["repo:write"])).toEqual(["repo"]);
		expect(gitHubScopeNames(["repo:read"])).toEqual([]);
	});
});

describe("OAuth wire format", () => {
	it("answers form-encoded unless the client asks for JSON, as GitHub does", async () => {
		const form = oauthResponse({ interval: 5, token_type: "bearer" }, null);
		expect(form.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(await form.text()).toBe("interval=5&token_type=bearer");

		const json = oauthResponse({ interval: 5 }, "application/json");
		expect(json.headers.get("content-type")).toContain("application/json");
		expect(await json.json()).toEqual({ interval: 5 });
	});

	it("reads form and JSON bodies into the same parameters", async () => {
		const form = new Request("https://x.test/", {
			method: "POST",
			body: "client_id=abc&scope=repo+read%3Aorg",
		});
		const fromForm = await readRequestParams(form);
		expect(fromForm.get("client_id")).toBe("abc");
		expect(fromForm.get("scope")).toBe("repo read:org");

		const json = new Request("https://x.test/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_id: "abc", interval: 5, nested: {} }),
		});
		const fromJson = await readRequestParams(json);
		expect(fromJson.get("client_id")).toBe("abc");
		expect(fromJson.get("interval")).toBe("5");
		expect(fromJson.has("nested")).toBe(false);

		const broken = new Request("https://x.test/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect([...(await readRequestParams(broken)).keys()]).toEqual([]);
	});

	it("refuses a body over the cap, declared or streamed, instead of parsing it", async () => {
		const oversize = `client_id=abc&pad=${"x".repeat(MAX_DEVICE_REQUEST_BYTES)}`;
		const declared = new Request("https://git.test/login/device/code", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: oversize,
		});
		await expect(readRequestParams(declared)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError,
		);
		const streamed = new Request("https://git.test/login/device/code", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(oversize));
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit);
		await expect(readRequestParams(streamed)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError,
		);
	});
});
