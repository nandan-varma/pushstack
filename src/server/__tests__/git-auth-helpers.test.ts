import { afterEach, describe, expect, it } from "vitest";
import { createAuthChallenge } from "../git-auth";
import { getMaxGitRequestBytes } from "../git-http-backend";

describe("createAuthChallenge", () => {
	it("returns Basic realm with default realm", () => {
		const header = createAuthChallenge();
		expect(header).toBe('Basic realm="Git Repository"');
	});

	it("returns Basic realm with custom realm", () => {
		expect(createAuthChallenge("My Repo")).toBe('Basic realm="My Repo"');
	});
});

describe("getMaxGitRequestBytes", () => {
	afterEach(() => {
		delete process.env.GIT_HTTP_MAX_BODY_BYTES;
	});

	it("defaults to 50MB", () => {
		expect(getMaxGitRequestBytes()).toBe(50 * 1024 * 1024);
	});

	it("reads from env var", () => {
		process.env.GIT_HTTP_MAX_BODY_BYTES = "1048576";
		expect(getMaxGitRequestBytes()).toBe(1048576);
	});

	it("ignores invalid env var and falls back to default", () => {
		process.env.GIT_HTTP_MAX_BODY_BYTES = "not-a-number";
		expect(getMaxGitRequestBytes()).toBe(50 * 1024 * 1024);
	});

	it("ignores zero and falls back to default", () => {
		process.env.GIT_HTTP_MAX_BODY_BYTES = "0";
		expect(getMaxGitRequestBytes()).toBe(50 * 1024 * 1024);
	});
});
