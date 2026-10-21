import git from "isomorphic-git";
import { concat, decodeAscii, decodeUtf8 } from "../edge-utils.js";
import { isNotFoundError } from "../git-errors.js";
import { listAllRefNames, refCollisionIn } from "../ops/branch.js";
import type { Repo } from "../ops/types.js";
import { storePack } from "../pack-write.js";
import { isSafeFullRefName } from "../refs.js";
import { FLUSH, pktLine, sideBandPackfile } from "./pkt-line.js";
import { collectReachableOids } from "./reachability.js";
import { type RepackOptions, repackRepository } from "./repack.js";
import { type GitHttpResult, type HttpHooks, rawFs, runStep } from "./types.js";

const ZERO_OID = "0".repeat(40);
const OID_RE = /^[0-9a-f]{40}$/;

export interface RefUpdateCommand {
	oldOid: string;
	newOid: string;
	refName: string;
}

export interface RefUpdateResult {
	refName: string;
	ok: boolean;
	reason?: string;
}

export interface ParsedReceivePack {
	refUpdates: RefUpdateCommand[];
	packData: Uint8Array;
	/** Capabilities the client asked for on its first command line. */
	capabilities: string[];
}

/**
 * Split a receive-pack body: pkt-line ref commands, flush, then raw PACK.
 * A command whose oids aren't 40 lowercase hex digits is dropped — it can
 * never be applied, and its oids would otherwise reach object-path lookups.
 */
export function parseReceivePackBody(body: Uint8Array): ParsedReceivePack {
	const refUpdates: RefUpdateCommand[] = [];
	let capabilities: string[] | undefined;
	let pos = 0;
	while (pos + 4 <= body.length) {
		const len = Number.parseInt(decodeAscii(body.subarray(pos, pos + 4)), 16);
		if (len === 0) {
			pos += 4;
			break;
		}
		if (len < 4) break;
		// The first command line carries NUL-separated capabilities.
		const [line, caps] = decodeUtf8(body.subarray(pos + 4, pos + len))
			.replace(/\n$/, "")
			.split("\0");
		if (capabilities === undefined) {
			capabilities = (caps ?? "").split(" ").filter(Boolean);
		}
		pos += len;
		const [oldOid, newOid, refName] = (line ?? "").split(" ");
		if (
			oldOid &&
			newOid &&
			refName &&
			OID_RE.test(oldOid) &&
			OID_RE.test(newOid)
		) {
			refUpdates.push({ oldOid, newOid, refName });
		}
	}
	return {
		refUpdates,
		packData: body.subarray(pos),
		capabilities: capabilities ?? [],
	};
}

export async function ensureRepoInitialized(
	repo: Repo,
	defaultBranch: string,
): Promise<void> {
	const fsp = rawFs(repo);
	try {
		await fsp.stat(`${repo.gitdir}/HEAD`);
	} catch (error) {
		// Only a genuinely missing HEAD means "not initialized". Any other probe
		// failure must reject the push rather than fall through to init on a
		// repo that is merely unreadable right now (#91).
		if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
		await fsp.mkdir(repo.gitdir, { recursive: true }).catch(() => {});
		await git.init({ ...repo, dir: repo.gitdir, defaultBranch, bare: true });
	}
}

export async function indexIncomingPack(
	repo: Repo,
	packData: Uint8Array,
	hooks?: HttpHooks,
): Promise<string[]> {
	if (packData.length < 4) return [];
	const packName = await runStep(
		hooks,
		"write + indexPack incoming pack",
		async () => {
			// Named by checksum (`pack-<sha>`), stored pack first, index last.
			const { base } = await storePack(repo, packData);
			return base;
		},
	);
	return [
		`${repo.gitdir}/objects/pack/${packName}.pack`,
		`${repo.gitdir}/objects/pack/${packName}.idx`,
	];
}

/**
 * Validate a ref name and compare-and-swap it against its claimed current
 * oid. Returns the failure result to report if either check fails, or
 * `null` when both pass — shared by the preflight check (`validateRefUpdates`,
 * run before the possibly-slow pack indexing/graph-walk work, purely to
 * avoid doing that work for an update already doomed to fail) and the real
 * atomicity guarantee (`applyRefUpdates`, run again right before writing,
 * since a concurrent push could have moved the ref in the time that work
 * took).
 */
async function checkRefCas(
	repo: Repo,
	refName: string,
	oldOid: string,
): Promise<RefUpdateResult | null> {
	if (!isSafeFullRefName(refName)) {
		return { refName, ok: false, reason: "invalid ref name" };
	}
	let currentOid: string;
	try {
		currentOid = await git.resolveRef({ ...repo, ref: refName });
	} catch (error) {
		// A ref that doesn't resolve yet is exactly what creating one looks
		// like (oldOid === ZERO_OID), so only a genuine not-found maps to
		// ZERO_OID. Any other read failure must reject the push: this CAS is
		// the only protection against `force: true` in applyRefUpdates, so
		// swallowing it would let a stale create claim overwrite a ref another
		// writer has since moved (see #91).
		if (!isNotFoundError(error)) throw error;
		currentOid = ZERO_OID;
	}
	return currentOid === oldOid
		? null
		: {
				refName,
				ok: false,
				reason: "non-fast-forward, ref updated by another push",
			};
}

/** Every branch/tag tip currently in the repo, as a validation boundary — see
 * its call site in {@link applyReceivePack}. */
async function collectExistingRefTips(repo: Repo): Promise<Set<string>> {
	const [branches, tags] = await Promise.all([
		git.listBranches(repo),
		git.listTags(repo),
	]);
	const refs = [
		...branches.map((b) => `refs/heads/${b}`),
		...tags.map((t) => `refs/tags/${t}`),
	];
	const oids = await Promise.all(
		refs.map(async (ref) => {
			try {
				return await git.resolveRef({ ...repo, ref });
			} catch (error) {
				// A tip that disappeared between list and resolve is a race; dropping
				// it can only widen the walk below (conservative), so skip it. A real
				// read failure must reject the push rather than silently turn a
				// storage error into a spurious "incomplete object graph".
				if (isNotFoundError(error)) return null;
				throw error;
			}
		}),
	);
	return new Set(oids.filter((oid): oid is string => oid !== null));
}

/**
 * The branch HEAD names, or null when HEAD is detached or unborn. A HEAD read
 * that *failed* must reject the push: `validateRefUpdates` reads null as "no
 * default branch to protect", so swallowing a real failure would let a push
 * delete the branch HEAD points at, leaving the repository with no default
 * branch (see #91).
 */
async function currentBranchRef(repo: Repo): Promise<string | null> {
	try {
		return (await git.currentBranch({ ...repo, fullname: true })) ?? null;
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
		return null;
	}
}

async function validateRefUpdates(
	repo: Repo,
	refUpdates: RefUpdateCommand[],
): Promise<RefUpdateResult[]> {
	const headRef = await currentBranchRef(repo);
	const seen = new Set<string>();
	return Promise.all(
		refUpdates.map(async ({ oldOid, newOid, refName }) => {
			// Two commands for one ref can't both be compare-and-swapped.
			if (seen.has(refName)) {
				return { refName, ok: false, reason: "duplicate ref update" };
			}
			seen.add(refName);
			// Same rule as git's receive.denyDeleteCurrent: deleting the
			// branch HEAD names leaves every clone without a default branch.
			if (newOid === ZERO_OID && refName === headRef) {
				return {
					refName,
					ok: false,
					reason: "deletion of the current branch prohibited",
				};
			}
			return (
				(await checkRefCas(repo, refName, oldOid)) ?? { refName, ok: true }
			);
		}),
	);
}

/**
 * Apply ref updates, enforcing compare-and-swap against each command's
 * claimed oldOid. Every client-supplied refName is validated before any
 * filesystem call reads or writes through it.
 */
export async function applyRefUpdates(
	repo: Repo,
	refUpdates: RefUpdateCommand[],
	hooks?: HttpHooks,
): Promise<RefUpdateResult[]> {
	return runStep(hooks, "apply ref updates", async () => {
		// Listed once per push: a creation may collide with an existing ref or
		// with another creation in the same push (the later one is refused).
		const taken = await listAllRefNames(repo);
		return Promise.all(
			refUpdates.map(async ({ oldOid, newOid, refName }) => {
				const failure = await checkRefCas(repo, refName, oldOid);
				if (failure) return failure;
				if (oldOid === ZERO_OID && newOid !== ZERO_OID) {
					const collision = refCollisionIn(taken, refName);
					taken.push(refName);
					if (collision) {
						return {
							refName,
							ok: false,
							reason: `cannot lock ref '${refName}': '${collision}' exists`,
						};
					}
				}

				if (newOid === ZERO_OID) {
					try {
						await git.deleteRef({ ...repo, ref: refName });
					} catch (error) {
						// Already gone is the goal state (the CAS just saw it, so this is
						// a concurrent delete). Any other failure means the ref is still
						// there: reporting success would tell the client a deletion
						// happened that didn't, so reject the push instead.
						if (!isNotFoundError(error)) throw error;
					}
				} else {
					// A branch must name a commit; a tag may name anything.
					if (refName.startsWith("refs/heads/")) {
						let type: string;
						try {
							({ type } = await git.readObject({
								...repo,
								oid: newOid,
								format: "content",
							}));
						} catch (error) {
							// A missing object means the pushed oid isn't there — a real
							// rejection. A read failure is not the same thing and must not
							// masquerade as one.
							if (!isNotFoundError(error)) throw error;
							type = "missing";
						}
						if (type !== "commit") {
							return {
								refName,
								ok: false,
								reason: `branch must point at a commit, not a ${type}`,
							};
						}
					}
					await git.writeRef({
						...repo,
						ref: refName,
						value: newOid,
						force: true,
					});
				}
				return { refName, ok: true };
			}),
		);
	});
}

/**
 * The report-status response for a set of ref-update results — empty unless
 * the client asked for `report-status`, and side-band-64k framed when it
 * asked for that (git and isomorphic-git both do; isomorphic-git always
 * demuxes the response as side-band). `unpackError` reports a pack that
 * couldn't be stored or indexed.
 */
export function receivePackResponse(
	results: RefUpdateResult[],
	options?: { capabilities?: readonly string[]; unpackError?: string },
): GitHttpResult {
	const capabilities = options?.capabilities ?? ["report-status"];
	const report = capabilities.includes("report-status")
		? concat(
				pktLine(
					options?.unpackError
						? `unpack ${options.unpackError}\n`
						: "unpack ok\n",
				),
				...results.map(({ refName, ok, reason }) =>
					pktLine(ok ? `ok ${refName}\n` : `ng ${refName} ${reason}\n`),
				),
				FLUSH,
			)
		: new Uint8Array();
	const responseBody =
		capabilities.includes("side-band-64k") && report.length > 0
			? sideBandPackfile(report)
			: report;

	return {
		status: 200,
		headers: {
			"Content-Type": "application/x-git-receive-pack-result",
			"Cache-Control": "no-cache",
		},
		body: responseBody,
	};
}

export interface ApplyReceivePackOptions {
	/** HEAD's branch when a push initializes an empty repository. */
	defaultBranch: string;
	/**
	 * Repack tuning, or `false` to skip repacking entirely. The returned
	 * `stalePackPaths` are gitdir-relative pack files the repack deleted from
	 * this repo — after syncing to any secondary storage, delete them there
	 * too.
	 */
	repack?: RepackOptions | false;
}

/** The outcome of {@link applyReceivePack}. */
export interface ApplyReceivePackResult {
	results: RefUpdateResult[];
	stalePackPaths: string[];
	/** Set when the incoming pack couldn't be stored or indexed. */
	unpackError?: string;
}

/**
 * The storage half of a push against `repo`: initialize if needed, index the
 * incoming pack, CAS-apply ref updates, then repack when enough packs have
 * accumulated. Serialize concurrent pushes to the same repo externally (a
 * per-repo lock); build the HTTP response afterwards with
 * {@link receivePackResponse}.
 *
 * A push that changes nothing must not leak its pack: ref updates only ever
 * fail here (a stale compare-and-swap, a branch pointed at a non-commit,
 * HEAD's branch deleted), so when none of them succeeded the incoming pack is
 * unlinked again — no ref names it, and the threshold repack only runs for
 * accepted pushes, so nothing would ever reclaim it.
 */
export async function applyReceivePack(
	repo: Repo,
	parsed: { refUpdates: RefUpdateCommand[]; packData: Uint8Array },
	options: ApplyReceivePackOptions,
	hooks?: HttpHooks,
): Promise<ApplyReceivePackResult> {
	await ensureRepoInitialized(repo, options.defaultBranch);
	const preflight = await validateRefUpdates(repo, parsed.refUpdates);
	const acceptedUpdates = parsed.refUpdates.filter(
		(_, index) => preflight[index]?.ok,
	);
	const fsp = rawFs(repo);
	const packDir = `${repo.gitdir}/objects/pack`;
	const existingPacks = new Set(
		await fsp.readdir(packDir).catch(() => [] as string[]),
	);
	let incomingPackPaths: string[];
	try {
		incomingPackPaths = await indexIncomingPack(
			repo,
			acceptedUpdates.some((update) => update.newOid !== ZERO_OID)
				? parsed.packData
				: new Uint8Array(),
			hooks,
		);
	} catch (err) {
		hooks?.onWarn?.("receive-pack: incoming pack rejected", err);
		return {
			results: preflight.map((result) =>
				result.ok ? { ...result, ok: false, reason: "unpacker error" } : result,
			),
			stalePackPaths: [],
			unpackError: "index-pack failed",
		};
	}
	// A checksum-named pack identical to one already stored must survive the
	// cleanup below. Index first, so readers never see a half-removed pack.
	const removableIncoming = incomingPackPaths
		.filter((path) => !existingPacks.has(path.slice(packDir.length + 1)))
		.sort((a, b) => Number(b.endsWith(".idx")) - Number(a.endsWith(".idx")));

	const newTips = acceptedUpdates
		.filter((update) => update.newOid !== ZERO_OID)
		.map((update) => update.newOid);
	if (newTips.length > 0) {
		// Every oid reachable from an existing ref was already accepted by an
		// earlier push — not just the ref(s) this push happens to touch. A
		// brand-new branch (oldOid === ZERO_OID, so it has no pre-image of its
		// own) is the common case this matters for: creating a branch off an
		// existing one is still just one new commit's worth of new objects,
		// and shouldn't cost a walk of the entire repo history to validate.
		const haveOids = await collectExistingRefTips(repo);
		for (const update of acceptedUpdates) {
			if (update.oldOid !== ZERO_OID) haveOids.add(update.oldOid);
		}
		const { complete } = await collectReachableOids(
			repo,
			newTips,
			hooks,
			haveOids,
		);
		if (!complete) {
			for (const filepath of removableIncoming) {
				await fsp.unlink(filepath).catch(() => {});
			}
			return {
				results: preflight.map((result) =>
					result.ok
						? { ...result, ok: false, reason: "incomplete object graph" }
						: result,
				),
				stalePackPaths: [],
			};
		}
	}

	const applied = await applyRefUpdates(repo, acceptedUpdates, hooks);
	const results = preflight.map((result, index) =>
		result.ok
			? (applied.find(
					(entry) => entry.refName === parsed.refUpdates[index]?.refName,
				) ?? result)
			: result,
	);
	if (!results.some((result) => result.ok)) {
		for (const filepath of removableIncoming) {
			await fsp.unlink(filepath).catch(() => {});
		}
		return { results, stalePackPaths: [] };
	}
	const repackOptions = options.repack;
	// Reached only when at least one ref update was applied above. Best-effort:
	// the refs have already moved, so a consolidation failure must not turn the
	// push into an error response the client will retry — the refs it pushed are
	// durable, and the next push repacks.
	let stalePackPaths: string[] = [];
	if (repackOptions !== false) {
		try {
			stalePackPaths = await runStep(hooks, "repack", () =>
				repackRepository(repo, repackOptions, hooks),
			);
		} catch (error) {
			hooks?.onWarn?.("repack after push failed (non-fatal)", error);
		}
	}
	return { results, stalePackPaths };
}
