import { describe, expect, it } from "vitest";
import {
	decodeGlobalNodeId,
	decodeNodeId,
	encodeGlobalNodeId,
	encodeNodeId,
	encodeReactionNodeId,
	rowIdOfNodeKey,
} from "../graphql/node-id";

const b64 = (text: string) => Buffer.from(text).toString("base64");

/** Legacy ids copied from live GitHub (cli/cli, #269), decoded to the code. */
const LIVE_LEGACY_IDS: Array<[type: string, key: string | number, id: string]> =
	[
		["Issue", 533077241, "MDU6SXNzdWU1MzMwNzcyNDE="],
		["IssueComment", 575836114, "MDEyOklzc3VlQ29tbWVudDU3NTgzNjExNA=="],
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
		"encodes and decodes GitHub's new-form %s id for key %s",
		(type, key, id) => {
			expect(encodeGlobalNodeId(type, 212613049, key)).toBe(id);
			expect(decodeGlobalNodeId(id)).toEqual({
				type,
				key: String(key),
				repositoryId: 212613049,
			});
		},
	);

	it("decodes the live REA_ samples, whose base64url uses - and _", () => {
		// rust-lang/rust (repository 724712): the samples' third and fourth
		// elements are the subject's and the reaction's row ids.
		for (const [id, subjectId, reactionId] of [
			["REA_lALOAAsO6M6U7Uupzg_bNn0", 2498579369, 266024573],
			["REA_lALOAAsO6M6-0Ru_zhMGi84", 3201375167, 319196110],
		] as const) {
			expect(id).toMatch(/[-_]/);
			expect(decodeGlobalNodeId(id)).toEqual({
				type: "Reaction",
				key: String(reactionId),
				repositoryId: 724712,
				subjectId,
			});
		}
	});

	it("encodes a reaction on an issue or a comment as GitHub's REA_ tuple", () => {
		// Tag 1: the reaction sits on pull request 502407912 itself.
		expect(
			encodeReactionNodeId(212613049, { issueId: 502407912 }, 206255088),
		).toBe("REA_lAHODKw3uc4d8iLozgxLM_A");
		// Tag 2: on issue comment 2498579369.
		expect(
			encodeReactionNodeId(
				724712,
				{ issueId: 1, commentId: 2498579369 },
				266024573,
			),
		).toBe("REA_lALOAAsO6M6U7Uupzg_bNn0");
	});

	it("packs a fixint repository id below 0x80 as one byte", () => {
		const id = encodeGlobalNodeId("Release", 0x7f, 1);
		expect(Buffer.from(id.slice(3), "base64url")).toEqual(
			Buffer.from([0x93, 0x00, 0x7f, 0x01]),
		);
		// 0x80 needs the uint8 form, so the id grows by one byte.
		expect(
			Buffer.from(encodeGlobalNodeId("Release", 0x80, 1).slice(3), "base64url"),
		).toEqual(Buffer.from([0x93, 0x00, 0xcc, 0x80, 0x01]));
		for (const [value, packed] of [
			[0xff, [0xcc, 0xff]],
			[0x100, [0xcd, 0x01, 0x00]],
			[0xffff, [0xcd, 0xff, 0xff]],
			[0x10000, [0xce, 0x00, 0x01, 0x00, 0x00]],
			[0xffffffff, [0xce, 0xff, 0xff, 0xff, 0xff]],
		] as const) {
			const bytes = Buffer.from(
				encodeGlobalNodeId("Release", 1, value).slice(3),
				"base64url",
			);
			expect([...bytes], String(value)).toEqual([0x93, 0x00, 0x01, ...packed]);
			expect(
				decodeGlobalNodeId(encodeGlobalNodeId("Release", 1, value)),
			).toEqual({ type: "Release", key: String(value), repositoryId: 1 });
		}
	});

	it("refuses values msgpack cannot hold as a uint32", () => {
		expect(() => encodeGlobalNodeId("Release", 2 ** 32, 1)).toThrow(RangeError);
		expect(() => encodeGlobalNodeId("Release", 1, -1)).toThrow(RangeError);
		expect(() => encodeGlobalNodeId("Release", 1, 1.5)).toThrow(RangeError);
		expect(() => encodeReactionNodeId(1, { issueId: 1 }, 2 ** 32)).toThrow(
			RangeError,
		);
	});

	it("does not decode a new-form id as legacy, or the reverse", () => {
		for (const [, , id] of LIVE_GLOBAL_IDS) {
			expect(decodeNodeId(id), id).toBeNull();
		}
		for (const [, , id] of LIVE_LEGACY_IDS) {
			expect(decodeGlobalNodeId(id), id).toBeNull();
		}
	});

	it("decodes nothing from a malformed new-form id", () => {
		for (const id of [
			"",
			"RE_",
			"XX_kwDODKw3uc4ZK3LB", // unknown prefix
			"RE_kwDODKw3uc4ZK3LB=", // padding
			"RE_not base64!",
			"RE_AAAA", // not a msgpack array
			// [0, repo, key] with a trailing byte.
			`RE_${Buffer.from([0x93, 0x00, 0x01, 0x01, 0x00]).toString("base64url")}`,
			// A four-element array under a three-element prefix.
			`RE_${Buffer.from([0x94, 0x00, 0x01, 0x01, 0x01]).toString("base64url")}`,
			// A reaction tagged with a subject the format does not have.
			`REA_${Buffer.from([0x94, 0x03, 0x01, 0x01, 0x01]).toString("base64url")}`,
			// A commit key that is not a string.
			`C_${Buffer.from([0x93, 0x00, 0x01, 0x01]).toString("base64url")}`,
		]) {
			expect(decodeGlobalNodeId(id), id).toBeNull();
		}
		expect(decodeGlobalNodeId(`RE_${"A".repeat(201)}`)).toBeNull();
		expect(decodeGlobalNodeId(`RE_${"A".repeat(300)}`)).toBeNull();
	});

	it("rejects an out-of-range row id, and accepts the maximum", () => {
		expect(rowIdOfNodeKey("2147483647")).toBe(2147483647);
		expect(rowIdOfNodeKey("2147483648")).toBeNull();
		expect(rowIdOfNodeKey("0")).toBeNull();
		expect(rowIdOfNodeKey("-1")).toBeNull();
		expect(rowIdOfNodeKey("1.5")).toBeNull();
		expect(rowIdOfNodeKey("01")).toBe(1);
		expect(rowIdOfNodeKey("12345678901")).toBeNull();
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

	it("decodes nothing from malformed legacy input", () => {
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

	it("rejects oversized legacy input before decoding it", () => {
		const oversized = encodeNodeId("Ref", `1:${"a".repeat(300)}`);
		expect(oversized.length).toBeGreaterThan(200);
		expect(decodeNodeId(oversized)).toBeNull();
		expect(decodeNodeId("A".repeat(201))).toBeNull();
	});
});
