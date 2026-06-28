import { describe, expect, it } from "vitest";
import { createAuthChallenge } from "../git-auth";

describe("createAuthChallenge", () => {
	it("returns Basic realm with default realm", () => {
		const header = createAuthChallenge();
		expect(header).toBe('Basic realm="Git Repository"');
	});

	it("returns Basic realm with custom realm", () => {
		expect(createAuthChallenge("My Repo")).toBe('Basic realm="My Repo"');
	});
});
