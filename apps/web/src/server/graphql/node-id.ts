/**
 * GitHub's legacy global node ids: base64 of `{code}:{Type}{key}`, where
 * `code` is GitHub's zero-padded type number, not the type name's length
 * (`04:User1` → "MDQ6VXNlcjE=", `010:Repository1` → "MDEwOlJlcG9zaXRvcnkx").
 * The REST API's `node_id` fields use the same encoding, so an id read from
 * either API resolves through `node(id:)`.
 */
/** Codes checked against live GitHub (`gh api`, see #269). */
const VERIFIED_CODES = {
	Issue: "05",
	IssueComment: "012",
	Label: "05",
	PullRequest: "011",
	Ref: "03",
	Repository: "010",
	User: "04",
} as const;

/**
 * GitHub gives these types the new global id (`RE_kwDO…`, `RA_kwDO…`,
 * `C_kwDO…`), so no legacy code is verified. They keep the pre-verification
 * codes (the type name's length) until #269 settles them.
 */
const UNVERIFIED_CODES = {
	Commit: "06",
	Milestone: "09",
	PullRequestReview: "17",
	Reaction: "08",
	Release: "07",
	ReleaseAsset: "12",
} as const;

const TYPE_CODES: Record<string, string> = {
	...VERIFIED_CODES,
	...UNVERIFIED_CODES,
};

export type NodeType =
	| keyof typeof VERIFIED_CODES
	| keyof typeof UNVERIFIED_CODES;

const LEGACY_ID_RE = /^(\d{2,3}):(.+)$/;

export function encodeNodeId(type: NodeType, key: string | number): string {
	return Buffer.from(`${TYPE_CODES[type]}:${type}${key}`).toString("base64");
}

/** The type and key a node id names, or null when it isn't one of ours. */
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
