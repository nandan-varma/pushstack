/**
 * Global node IDs in GitHub's legacy format: base64 of `{len}:{Type}{key}`,
 * where `len` is the type name's length, two digits (`04:User1` → "MDQ6VXNlcjE=").
 * The REST API's `node_id` fields use the same encoding, so an id read from
 * either API resolves through `node(id:)`.
 */
const LEGACY_ID_RE = /^(\d{2}):([A-Za-z]+)(.+)$/;

export function encodeNodeId(type: string, key: string | number): string {
	const prefix = String(type.length).padStart(2, "0");
	return Buffer.from(`${prefix}:${type}${key}`).toString("base64");
}

/** The type and key a node id names, or null when it isn't one of ours. */
export function decodeNodeId(id: string): { type: string; key: string } | null {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(id) || id.length > 200) return null;
	const match = LEGACY_ID_RE.exec(Buffer.from(id, "base64").toString("utf8"));
	if (!match) return null;
	const [, length, rest = "", tail = ""] = match;
	const type = rest.slice(0, Number(length));
	if (type.length !== Number(length)) return null;
	const key = rest.slice(Number(length)) + tail;
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
