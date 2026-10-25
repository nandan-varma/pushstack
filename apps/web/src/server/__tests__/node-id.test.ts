import { describe, expect, it } from "vitest";
import {
	decodeNodeId,
	encodeGlobalNodeId,
	encodeNodeId,
} from "../graphql/node-id";

const b64 = (text: string) => Buffer.from(text).toString("base64");

/** Legacy ids copied from live GitHub (cli/cli, #269), decoded to the code. */
const LIVE_LEGACY_IDS: Array<[type: string, key: string | number, id: string]> =
	[
		["Issue", 533077241, "MDU6SXNzdWU1MzMwNzcyNDE="],
		["IssueComment", 575836114, "MDEyOklzc3VlQ29tbWVudDU3NTgzNjExNA=="],
		["IssueReaction", 57244731, "MDEzOklzc3VlUmVhY3Rpb241NzI0NDczMQ=="],
		["Label", 1698076173, "MDU6TGFiZWwxNjk4MDc2MTcz"],
		["Milestone", 1354258, "MDk6TWlsZXN0b25lMTM1NDI1OA=="],
		["PullRequest", 324495027, "MDExOlB1bGxSZXF1ZXN0MzI0NDk1MDI3"],
		[
			"PullRequestReview",
			298657319,
			"MDE3OlB1bGxSZXF1ZXN0UmV2aWV3Mjk4NjU3MzE5",
		],
		[
			"Ref",
			"212613049:refs/heads/trunk",
			"MDM6UmVmMjEyNjEzMDQ5OnJlZnMvaGVhZHMvdHJ1bms=",
		],
		["Repository", 212613049, "MDEwOlJlcG9zaXRvcnkyMTI2MTMwNDk="],
		["User", 583231, "MDQ6VXNlcjU4MzIzMQ=="],
	];

/** New-form ids from live GitHub: repository 212613049 (cli/cli). */
const LIVE_GLOBAL_IDS: Array<
	[
		type: "Commit" | "IssueComment" | "Release" | "ReleaseAsset",
		key: number | string,
		id: string,
	]
> = [
	["Release", 422277825, "RE_kwDODKw3uc4ZK3LB"],
	["ReleaseAsset", 670305018, "RA_kwDODKw3uc4n9Ar6"],
	["IssueComment", 3987079426, "IC_kwDODKw3uc7tpgEC"],
	[
		"Commit",
		"4f2cfe92e3499f8581bf39db77e0a1431fa7b55c",
		"C_kwDODKw3udoAKDRmMmNmZTkyZTM0OTlmODU4MWJmMzlkYjc3ZTBhMTQzMWZhN2I1NWM",
	],
];

describe("node ids", () => {
	it.each(LIVE_LEGACY_IDS)(
		"encodes and decodes live GitHub %s id %s",
		(type, key, id) => {
			expect(encodeNodeId(type as "Issue", key)).toBe(id);
			expect(decodeNodeId(id)).toEqual({ type, key: String(key) });
		},
	);

	it.each(LIVE_GLOBAL_IDS)(
		"encodes GitHub's new-form %s id for key %s",
		(type, key, id) => {
			expect(encodeGlobalNodeId(type, 212613049, key)).toBe(id);
		},
	);

	it("refuses values msgpack cannot hold as a uint32", () => {
		expect(() => encodeGlobalNodeId("Release", 2 ** 32, 1)).toThrow(RangeError);
		expect(() => encodeGlobalNodeId("Release", 1, -1)).toThrow(RangeError);
		expect(() => encodeGlobalNodeId("Release", 1, 1.5)).toThrow(RangeError);
	});

	it("does not decode new-form ids as legacy", () => {
		for (const [, , id] of LIVE_GLOBAL_IDS) {
			expect(decodeNodeId(id), id).toBeNull();
		}
	});

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
