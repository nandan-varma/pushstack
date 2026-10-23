import git from "isomorphic-git";
import { concat, decodeAscii, decodeUtf8 } from "../edge-utils.js";
import { isAbsentError, isNotFoundError } from "../git-errors.js";
import {
	getPromisesFs,
	hasRecursiveFileLister,
	listAllRefNames,
	refCollisionIn,
	resolveLooseRefFast,
} from "../ops/branch.js";
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
	return (await storeIncomingPack(repo, packData, hooks)).paths;
}

/** {@link indexIncomingPack}, also returning the oids the pack's index lists. */
async function storeIncomingPack(
	repo: Repo,
	packData: Uint8Array,
	hooks?: HttpHooks,
): Promise<{ paths: string[]; oids: string[] }> {
	if (packData.length < 4) return { paths: [], oids: [] };
	const stored = await runStep(
		hooks,
		"write + indexPack incoming pack",
		async () => {
			// Named by checksum (`pack-<sha>`), stored pack first, index last.
			return storePack(repo, packData);
		},
	);
	return {
		paths: [
			`${repo.gitdir}/objects/pack/${stored.base}.pack`,
			`${repo.gitdir}/objects/pack/${stored.base}.idx`,
		],
		oids: stored.oids,
	};
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

/**
 * Every ref's full name, from one listing. On an object store that is a
 * single recursive LIST of `refs/` (plus a read of `packed-refs`, which is
 * free for a gitdir registered as never having one); otherwise it falls back
 * to isomorphic-git's directory walk. A push derives the tips to validate
 * against and the file/directory collision set from this one snapshot instead
 * of listing refs three separate ways. The caller holds the repository lock,
 * so nothing else moves a ref between the snapshot and the writes; the
 * compare-and-swap in {@link applyRefUpdates} still re-reads every ref it
 * updates.
 */
async function snapshotRefNames(repo: Repo): Promise<string[]> {
	const promises = getPromisesFs(repo.fs);
	if (!hasRecursiveFileLister(repo.fs) || !promises) {
		return listAllRefNames(repo);
	}
	const [loose, packed] = await Promise.all([
		repo.fs.listFilesRecursively(`${repo.gitdir}/refs`),
		promises
			.readFile(`${repo.gitdir}/packed-refs`, "utf8")
			.then((content) =>
				typeof content === "string" ? content : decodeUtf8(content),
			)
			.catch((error: unknown) => {
				if (isAbsentError(error)) return "";
				throw error;
			}),
	]);
	const names = new Set(loose.map((name) => `refs/${name}`));
	for (const line of packed.split("\n")) {
		const match = /^[0-9a-f]{40} (refs\/.+)$/i.exec(line.trim());
		if (match?.[1]) names.add(match[1]);
	}
	return [...names];
}

/** Every branch/tag tip among `refNames`, as a validation boundary — see its
 * call site in {@link applyReceivePack}. */
async function collectExistingRefTips(
	repo: Repo,
	refNames: readonly string[],
): Promise<Set<string>> {
	const refs = refNames.filter(
		(name) => name.startsWith("refs/heads/") || name.startsWith("refs/tags/"),
	);
	const oids = await Promise.all(
		refs.map(async (ref) => {
			try {
				return await resolveLooseRefFast(repo, ref);
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

function isCreation({ oldOid, newOid }: RefUpdateCommand): boolean {
	return oldOid === ZERO_OID && newOid !== ZERO_OID;
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
	/** Every ref name, when the caller already listed them under the lock. */
	knownRefNames?: readonly string[],
): Promise<RefUpdateResult[]> {
	return runStep(hooks, "apply ref updates", async () => {
		// Listed at most once per push, and not at all when nothing is created:
		// a creation may collide with an existing ref or with another creation
		// in the same push (the later one is refused).
		const taken = [
			...(knownRefNames ??
				(refUpdates.some(isCreation) ? await snapshotRefNames(repo) : [])),
		];
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
	// Null when the listing failed for a reason other than the directory being
	// absent: the post-push repack must then list the directory itself.
	const listedPacks = await fsp.readdir(packDir).catch((error: unknown) => {
		if (isAbsentError(error)) return [] as string[];
		hooks?.onWarn?.("receive-pack: listing the pack directory failed", error);
		return null;
	});
	const existingPacks = new Set(listedPacks ?? []);
	let incomingPackPaths: string[];
	let incomingOids: ReadonlySet<string> = new Set();
	try {
		const stored = await storeIncomingPack(
			repo,
			acceptedUpdates.some((update) => update.newOid !== ZERO_OID)
				? parsed.packData
				: new Uint8Array(),
			hooks,
		);
		incomingPackPaths = stored.paths;
		incomingOids = new Set(stored.oids);
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

	// Listed at most once, only when the tips or the collision check need it.
	let refNames: string[] | undefined;
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
		refNames = await snapshotRefNames(repo);
		const haveOids = await collectExistingRefTips(repo, refNames);
		for (const update of acceptedUpdates) {
			if (update.oldOid !== ZERO_OID) haveOids.add(update.oldOid);
		}
		const { complete, invalidTreeEntry } = await collectReachableOids(
			repo,
			newTips,
			hooks,
			haveOids,
			// Only the trees this push stored are checked: older trees the walk
			// passes through were accepted by earlier pushes.
			{ checkTreeNames: incomingOids },
		);
		if (invalidTreeEntry) {
			// What `receive.fsckObjects` refuses: names that become path
			// traversal or a nested `.git` in an archive or a checkout.
			for (const filepath of removableIncoming) {
				await fsp.unlink(filepath).catch(() => {});
			}
			return {
				results: preflight.map((result) =>
					result.ok
						? {
								...result,
								ok: false,
								reason: `fsck error in packed object: ${invalidTreeEntry.message}`,
							}
						: result,
				),
				stalePackPaths: [],
			};
		}
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

	const applied = await applyRefUpdates(repo, acceptedUpdates, hooks, refNames);
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
		// The lock is held, so the pack directory is what was listed before
		// indexing plus the pack this push stored: no need to list it again
		// (unless that listing failed, when the repack lists it itself).
		const packDirectory =
			listedPacks === null
				? undefined
				: [
						...existingPacks,
						...incomingPackPaths.map((path) => path.slice(packDir.length + 1)),
					];
		try {
			stalePackPaths = await runStep(hooks, "repack", () =>
				repackRepository(
					repo,
					packDirectory ? { ...repackOptions, packDirectory } : repackOptions,
					hooks,
				),
			);
		} catch (error) {
			hooks?.onWarn?.("repack after push failed (non-fatal)", error);
		}
	}
	return { results, stalePackPaths };
}
