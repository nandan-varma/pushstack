/**
 * GitHub's node ids come in two forms. The legacy form is base64 of
 * `{code}:{Type}{key}`, where `code` is GitHub's zero-padded type number, not
 * the type name's length (`04:User1` → "MDQ6VXNlcjE=", `010:Repository1` →
 * "MDEwOlJlcG9zaXRvcnkx"). The REST API's `node_id` fields use the same
 * encoding, so an id read from either API resolves through `node(id:)`.
 *
 * The new form is `PREFIX_` + base64url of a msgpack fixarray. GitHub serves it
 * for releases (`RE_`), release assets (`RA_`), commits (`C_`), issue comments
 * (`IC_`) and reactions (`REA_`); users, repositories, issues, pull requests,
 * labels, milestones and refs stay legacy. The array is `[0, repositoryId,
 * key]`, where `key` is the row id or, for a commit, the sha; a reaction's
 * `REA_` id carries a fourth element, `[tag, repositoryId, subjectId,
 * reactionId]`, tagged 1 for a reaction on the issue or pull request itself and
 * 2 for one on an issue comment (samples decoded from `gh api`, #269).
 */

/**
 * Legacy codes checked against live GitHub on cli/cli (#269, samples decoded
 * from `gh api` and GraphQL). `05` is shared by Issue and Label; the name
 * tells them apart.
 */
const TYPE_CODES = {
	Issue: "05",
	IssueComment: "012",
	Label: "05",
	Milestone: "09",
	PullRequest: "011",
	PullRequestReview: "017",
	Ref: "03",
	Repository: "010",
	User: "04",
} as const;

/**
 * Prefixes of the new form, observed on cli/cli (repository 212613049, the
 * id GitHub encodes in the middle slot). Samples: `RE_kwDODKw3uc4ZK3LB` is
 * release 422277825, `RA_kwDODKw3uc4n9Ar6` is asset 670305018,
 * `IC_kwDODKw3uc7tpgEC` is comment 3987079426,
 * `C_kwDODKw3udoAKDRmMmNmZTky…` is commit 4f2cfe92e3499f8581bf39db77e0a1431fa7b55c,
 * and `REA_lAHODKw3uc4d8iLozgxLM_A` is reaction 206255088 on pull request
 * 502407912.
 */
const GLOBAL_PREFIX = {
	Commit: "C",
	IssueComment: "IC",
	Reaction: "REA",
	Release: "RE",
	ReleaseAsset: "RA",
} as const;

type NodeType = keyof typeof TYPE_CODES;

type GlobalNodeType = keyof typeof GLOBAL_PREFIX;

/** The new form's three-element types: everything but a reaction. */
type ScopedNodeType = Exclude<GlobalNodeType, "Reaction">;

/** Longest first, so `REA_` is not read as `RE_`. */
const GLOBAL_TYPES = (
	Object.entries(GLOBAL_PREFIX) as Array<[GlobalNodeType, string]>
).sort(([, a], [, b]) => b.length - a.length);

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
	type: ScopedNodeType,
	repositoryId: number,
	key: number | string,
): string {
	const tuple = [
		0x93, // fixarray of three
		0x00, // leading zero, the tag seen in every sample of these types
		...msgpackUint(repositoryId),
		...(typeof key === "number" ? msgpackUint(key) : msgpackStr(key)),
	];
	return `${GLOBAL_PREFIX[type]}_${Buffer.from(tuple).toString("base64url")}`;
}

/**
 * A reaction's `node_id`: the new form's four-element tuple, tagging the
 * subject a reaction sits on (1: the issue or pull request, 2: an issue
 * comment) and naming it by row id before the reaction's own.
 */
export function encodeReactionNodeId(
	repositoryId: number,
	subject: { issueId: number; commentId?: number },
	reactionId: number,
): string {
	const subjectId = subject.commentId ?? subject.issueId;
	const tag = subject.commentId === undefined ? 1 : 2;
	const tuple = [
		0x94, // fixarray of four
		tag,
		...msgpackUint(repositoryId),
		...msgpackUint(subjectId),
		...msgpackUint(reactionId),
	];
	return `${GLOBAL_PREFIX.Reaction}_${Buffer.from(tuple).toString("base64url")}`;
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
		(name) => TYPE_CODES[name as NodeType] === code && rest.startsWith(name),
	) as NodeType | undefined;
	if (!type) return null;
	const key = rest.slice(type.length);
	return key ? { type, key } : null;
}

/** A decoded new-form id: the type, the key, and the repository it names. */
export interface DecodedGlobalNodeId {
	type: GlobalNodeType;
	/** The row id (the reaction's own for `REA_`), or a commit's sha. */
	key: string;
	repositoryId: number;
	/** A `REA_` reaction's subject: an issue, pull request or issue comment. */
	subjectId?: number;
}
/** The type, key and repository a new-form node id names, or null. Only the
 * canonical spelling is accepted: a padded or re-encoded body is not an id
 * GitHub (or we) ever issued.
 */
export function decodeGlobalNodeId(id: string): DecodedGlobalNodeId | null {
	if (id.length > 300) return null;
	const found = GLOBAL_TYPES.find(([, prefix]) => id.startsWith(`${prefix}_`));
	if (!found) return null;
	const [type, prefix] = found;
	const tuple = readTuple(id, prefix);
	return tuple ? nodeOfTuple(type, tuple) : null;
}

/**
 * Projects v2 are owned by a user, not a repository, so their new-form ids
 * carry the owner's numeric id in the middle slot. Single-select fields share
 * `project_v2_fields` with the others; the prefix names the GraphQL type.
 */
const PROJECT_PREFIX = {
	ProjectV2: "PVT",
	ProjectV2Item: "PVTI",
	ProjectV2Field: "PVTF",
	ProjectV2SingleSelectField: "PVTSSF",
} as const;

export type ProjectNodeType = keyof typeof PROJECT_PREFIX;

/** Longest first, so `PVTSSF_` is not read as `PVT_`. */
const PROJECT_TYPES = (
	Object.entries(PROJECT_PREFIX) as Array<[ProjectNodeType, string]>
).sort(([, a], [, b]) => b.length - a.length);

export interface DecodedProjectNodeId {
	type: ProjectNodeType;
	key: string;
	/** The project row the object belongs to (the project itself for `PVT_`). */
	scopeId: number;
}

export function encodeProjectNodeId(
	type: ProjectNodeType,
	scopeId: number,
	key: number,
): string {
	const tuple = [
		0x93, // fixarray of three
		0x00,
		...msgpackUint(scopeId),
		...msgpackUint(key),
	];
	return `${PROJECT_PREFIX[type]}_${Buffer.from(tuple).toString("base64url")}`;
}

export function decodeProjectNodeId(id: string): DecodedProjectNodeId | null {
	if (id.length > 300) return null;
	const found = PROJECT_TYPES.find(([, prefix]) => id.startsWith(`${prefix}_`));
	if (!found) return null;
	const [type, prefix] = found;
	const tuple = readTuple(id, prefix);
	if (tuple?.length !== 3 || tuple[0] !== 0) return null;
	const [, scopeId, key] = tuple;
	return typeof scopeId === "number" && typeof key === "number"
		? { type, key: String(key), scopeId }
		: null;
}

/** A node id's body as a msgpack tuple, or null for anything else. */
function readTuple(id: string, prefix: string): MsgpackValue[] | null {
	const body = id.slice(prefix.length + 1);
	if (!/^[A-Za-z0-9_-]+$/.test(body) || body.length > 200) return null;
	const bytes = Buffer.from(body, "base64url");
	if (bytes.toString("base64url") !== body) return null;
	return readMsgpackTuple(bytes);
}

/** The node a tuple names, or null when the tuple isn't that type's shape. */
function nodeOfTuple(
	type: GlobalNodeType,
	tuple: MsgpackValue[],
): DecodedGlobalNodeId | null {
	const [tag, repositoryId, third, fourth] = tuple;
	if (typeof repositoryId !== "number") return null;
	if (type === "Reaction") {
		// 1: the issue or pull request, 2: an issue comment.
		if (tuple.length !== 4 || (tag !== 1 && tag !== 2)) return null;
		if (typeof third !== "number" || typeof fourth !== "number") return null;
		return { type, key: String(fourth), repositoryId, subjectId: third };
	}
	if (tuple.length !== 3 || tag !== 0) return null;
	if (type === "Commit") {
		return typeof third === "string"
			? { type, key: third, repositoryId }
			: null;
	}
	return typeof third === "number"
		? { type, key: String(third), repositoryId }
		: null;
}

type MsgpackValue = number | string;

/** A msgpack fixarray of three or four of them, or null for anything else. */
function readMsgpackTuple(bytes: Buffer): MsgpackValue[] | null {
	const length = bytes[0];
	if (length !== 0x93 && length !== 0x94) return null;
	const values: MsgpackValue[] = [];
	let at = 1;
	for (let n = 0; n < length - 0x90; n++) {
		const read = readMsgpackValue(bytes, at);
		if (!read) return null;
		values.push(read.value);
		at = read.next;
	}
	return at === bytes.length ? values : null;
}

function readMsgpackValue(
	bytes: Buffer,
	at: number,
): { value: MsgpackValue; next: number } | null {
	const head = bytes[at];
	if (head === undefined) return null;
	// fixint, and the three widths of uint the samples use.
	if (head < 0x80) return { value: head, next: at + 1 };
	if (head === 0xcc || head === 0xcd || head === 0xce) {
		const size = 1 << (head - 0xcc);
		if (at + 1 + size > bytes.length) return null;
		const value =
			head === 0xcc
				? bytes.readUInt8(at + 1)
				: head === 0xcd
					? bytes.readUInt16BE(at + 1)
					: bytes.readUInt32BE(at + 1);
		return { value, next: at + 1 + size };
	}
	if (head === 0xda) {
		if (at + 3 > bytes.length) return null;
		const size = bytes.readUInt16BE(at + 1);
		if (at + 3 + size > bytes.length) return null;
		return {
			value: bytes.toString("utf8", at + 3, at + 3 + size),
			next: at + 3 + size,
		};
	}
	return null;
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
