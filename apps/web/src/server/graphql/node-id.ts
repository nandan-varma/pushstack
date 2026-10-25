/**
 * GitHub's node ids come in two forms. The legacy form is base64 of
 * `{code}:{Type}{key}`, where `code` is GitHub's zero-padded type number, not
 * the type name's length (`04:User1` → "MDQ6VXNlcjE=", `010:Repository1` →
 * "MDEwOlJlcG9zaXRvcnkx"). The REST API's `node_id` fields use the same
 * encoding, so an id read from either API resolves through `node(id:)`.
 *
 * The new form is `PREFIX_` + base64url of a msgpack array `[0, repositoryId,
 * key]` (see `encodeGlobalNodeId`). GitHub serves it for release, release
 * asset, commit and (on REST) issue comment `node_id`s; users, repositories,
 * issues, pull requests and labels stay legacy.
 */

/**
 * Legacy codes checked against live GitHub on cli/cli (#269, samples decoded
 * from `gh api` and GraphQL). `05` is shared by Issue and Label; the name
 * tells them apart.
 */
const VERIFIED_CODES = {
	Issue: "05",
	IssueComment: "012",
	IssueReaction: "013",
	Label: "05",
	Milestone: "09",
	PullRequest: "011",
	PullRequestReview: "017",
	Ref: "03",
	Repository: "010",
	User: "04",
} as const;

/**
 * Types with no confirmed legacy code. GitHub serves Release, ReleaseAsset
 * and Commit `node_id`s in the new form (see `GLOBAL_PREFIX`), and none of
 * the legacy codes below has been seen in a live id. Their values are the
 * pre-verification guesses (the type name's length) and are kept only so the
 * legacy encoder still has a value for them. `Reaction` has no sample for
 * comment or commit reactions; the issue reaction sample is `013:IssueReaction`.
 */
const UNVERIFIED_CODES = {
	Commit: "06",
	Reaction: "08",
	Release: "07",
	ReleaseAsset: "12",
} as const;

/**
 * Prefixes of the new form, observed on cli/cli (repository 212613049, the
 * id GitHub encodes in the middle slot). Samples: `RE_kwDODKw3uc4ZK3LB` is
 * release 422277825, `RA_kwDODKw3uc4n9Ar6` is asset 670305018,
 * `IC_kwDODKw3uc7tpgEC` is comment 3987079426, and
 * `C_kwDODKw3udoAKDRmMmNm…` is commit 4f2cfe92e3499f8581bf39db77e0a1431fa7b55c.
 */
const GLOBAL_PREFIX = {
	Commit: "C",
	IssueComment: "IC",
	Release: "RE",
	ReleaseAsset: "RA",
} as const;

const TYPE_CODES: Record<string, string> = {
	...VERIFIED_CODES,
	...UNVERIFIED_CODES,
};

export type NodeType =
	| keyof typeof VERIFIED_CODES
	| keyof typeof UNVERIFIED_CODES;

export type GlobalNodeType = keyof typeof GLOBAL_PREFIX;

const LEGACY_ID_RE = /^(\d{2,3}):(.+)$/;

export function encodeNodeId(type: NodeType, key: string | number): string {
	return Buffer.from(`${TYPE_CODES[type]}:${type}${key}`).toString("base64");
}

/**
 * GitHub's new-form `node_id` for a repository-scoped object: `PREFIX_` +
 * base64url of msgpack `[0, repositoryId, key]`, where `key` is the row id or,
 * for a commit, the sha. Integers use the smallest msgpack form (matching the
 * samples' `uint32`s); strings use `str16`, as the one commit sample does.
 */
export function encodeGlobalNodeId(
	type: GlobalNodeType,
	repositoryId: number,
	key: number | string,
): string {
	const bytes = [
		0x93, // fixarray of three
		0x00, // leading zero, the format version seen in every sample
		...msgpackUint(repositoryId),
		...(typeof key === "number" ? msgpackUint(key) : msgpackStr(key)),
	];
	return `${GLOBAL_PREFIX[type]}_${Buffer.from(bytes).toString("base64url")}`;
}

function msgpackUint(n: number): number[] {
	if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
		throw new RangeError(`node id value ${n} is not a 32-bit unsigned integer`);
	}
	if (n < 0x80) return [n];
	if (n <= 0xff) return [0xcc, n];
	if (n <= 0xffff) return [0xcd, n >>> 8, n & 0xff];
	return [
		0xce,
		(n >>> 24) & 0xff,
		(n >>> 16) & 0xff,
		(n >>> 8) & 0xff,
		n & 0xff,
	];
}

function msgpackStr(s: string): number[] {
	const body = [...Buffer.from(s, "utf8")];
	if (body.length > 0xffff) throw new RangeError("node id key is too long");
	return [0xda, body.length >>> 8, body.length & 0xff, ...body];
}

/** The type and key a legacy node id names, or null when it isn't one of ours. */
export function decodeNodeId(
	id: string,
): { type: NodeType; key: string } | null {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(id) || id.length > 200) return null;
	const match = LEGACY_ID_RE.exec(Buffer.from(id, "base64").toString("utf8"));
	if (!match) return null;
	const [, code = "", rest = ""] = match;
	// Codes are shared (`05` names both Issue and Label), so the name decides.
	const type = Object.keys(TYPE_CODES).find(
		(name) => TYPE_CODES[name] === code && rest.startsWith(name),
	) as NodeType | undefined;
	if (!type) return null;
	const key = rest.slice(type.length);
	return key ? { type, key } : null;
}

/** Postgres `integer` ids top out here; a bigger key can't name a row. */
const MAX_ROW_ID = 2_147_483_647;

/**
 * A node key as a row id, or null. Out-of-range keys are rejected before the
 * lookup: in a batched `nodes(ids:)` load one would fail the whole query.
 */
export function rowIdOfNodeKey(key: string): number | null {
	if (!/^\d{1,10}$/.test(key)) return null;
	const id = Number(key);
	return id >= 1 && id <= MAX_ROW_ID ? id : null;
}
