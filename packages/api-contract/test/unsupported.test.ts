import { describe, expect, it } from "vitest";
import { endpoints } from "../src";

describe("unsupported fields", () => {
	it("refuse any value of a field PushStack does not implement", () => {
		const body = endpoints["repos/update"].body;
		expect(body.safeParse({ allow_auto_merge: true }).success).toBe(false);
		expect(body.safeParse({ allow_auto_merge: null }).success).toBe(false);
		expect(body.safeParse({}).success).toBe(true);
	});

	it("accept an empty annotations or images array on a check run as a no-op", () => {
		const body = endpoints["checks/create"].body;
		const output = { title: "CI", summary: "Passed" };
		expect(
			body.safeParse({
				name: "ci",
				head_sha: "abc123",
				output: { ...output, annotations: [], images: [] },
			}).success,
		).toBe(true);
		expect(
			body.safeParse({
				name: "ci",
				head_sha: "abc123",
				output: { ...output, annotations: [{ path: "a.txt" }] },
			}).success,
		).toBe(false);
	});

	it("accept read: true on the mark-as-read body and refuse read: false", () => {
		const body = endpoints["activity/mark-notifications-as-read"].body;
		expect(body.safeParse({ read: true }).success).toBe(true);
		expect(body.safeParse({ read: false }).success).toBe(false);
	});

	it("take issue type as * or none only", () => {
		const query = endpoints["issues/list-for-repo"].query;
		expect(query.safeParse({ type: "*" }).success).toBe(true);
		expect(query.safeParse({ type: "none" }).success).toBe(true);
		expect(query.safeParse({ type: "pr" }).success).toBe(false);
		expect(query.safeParse({ type: "bug" }).success).toBe(false);
	});
});
