import { describe, expect, it } from "vitest";
import { decodeNodeId, encodeNodeId } from "../graphql/node-id";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("node ids", () => {
	it("encodes GitHub's legacy codes and round-trips them", () => {
		expect(encodeNodeId("User", 1)).toBe("MDQ6VXNlcjE=");
		expect(encodeNodeId("Repository", 1)).toBe("MDEwOlJlcG9zaXRvcnkx");
		expect(encodeNodeId("PullRequest", 7)).toBe(b64("011:PullRequest7"));
		expect(decodeNodeId(encodeNodeId("Repository", 1))).toEqual({
			type: "Repository",
			key: "1",
		});
		expect(decodeNodeId(encodeNodeId("Ref", "5:refs/heads/a/b"))).toEqual({
			type: "Ref",
			key: "5:refs/heads/a/b",
		});
	});

	it("tells Issue and Label apart by name, though they share code 05", () => {
		expect(decodeNodeId(encodeNodeId("Issue", 3))).toEqual({
			type: "Issue",
			key: "3",
		});
		expect(decodeNodeId(encodeNodeId("Label", 3))).toEqual({
			type: "Label",
			key: "3",
		});
	});

	it("decodes nothing from malformed input", () => {
		for (const id of [
			"",
			"not base64!",
			"MDEwOlJlcG9zaXRvcnkx=====", // too much padding
			b64("garbage"),
			b64("010:Repository"), // no key
			b64("10:Repository1"), // a length code, not GitHub's
			b64("999:Repository1"), // unknown code
			b64("010:Nonsense1"), // unknown type name
			b64("011:Repository1"), // another type's code
			b64("010:"), // empty
			b64("010:Repository1\n"), // a newline is not part of the id
		]) {
			expect(decodeNodeId(id), id).toBeNull();
		}
	});

	it("rejects oversized input before decoding it", () => {
		const oversized = encodeNodeId("Ref", `1:${"a".repeat(300)}`);
		expect(oversized.length).toBeGreaterThan(200);
		expect(decodeNodeId(oversized)).toBeNull();
		expect(decodeNodeId("A".repeat(201))).toBeNull();
	});
});
