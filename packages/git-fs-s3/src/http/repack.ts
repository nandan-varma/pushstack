/**
 * Pack consolidation: merge all packs into one, reusing stored (possibly
 * deltified) entries when every object is packed.
 *
 * Edge-compatible: uses Web Crypto (SHA-1), CompressionStream (deflate),
 * and Uint8Array throughout — no node:crypto, node:zlib, or Buffer.
 */

import git from "isomorphic-git";
import { isAbsentError, isNotFoundError } from "../git-errors.js";
import type { Repo } from "../ops/types.js";
import {
	keepFileContent,
	keepUntilOf,
	type PackFileName,
	packFileName,
	parsePackDirectory,
} from "../pack-files.js";
import { readPackIndex } from "../pack-index.js";
import {
	encodePack,
	hashGitObject,
	type PackObject,
	type PackObjectType,
	packBaseName,
} from "../pack-write.js";
import { buildPackFromExistingPacks } from "./pack-reuse.js";
import { collectReachableOids } from "./reachability.js";
import { type HttpHooks, rawFs } from "./types.js";

/**
 * Read every reachable object and independently re-derive its oid from the
 * bytes isomorphic-git handed back, instead of trusting the oid it was asked
 * for. isomorphic-git's *packed*-object read path never verifies the
 * resolved content's SHA-1 against the requested oid — only the
 * loose-object branch does.
 */
async function readAndVerifyObjects(
	repo: Repo,
	oids: string[],
): Promise<Map<string, PackObject>> {
	const objects = new Map<string, PackObject>();
	const BATCH_SIZE = 100;
	for (let i = 0; i < oids.length; i += BATCH_SIZE) {
		const batch = oids.slice(i, i + BATCH_SIZE);
		const entries = await Promise.all(
			batch.map(async (oid) => {
				const { type, object } = await git.readObject({
					...repo,
					oid,
					format: "content",
				});
				// Own ArrayBuffer-backed copy: Web APIs (Blob, digest) reject
				// views that might sit on a SharedArrayBuffer.
				const content = new Uint8Array(object as Uint8Array);
				const actualOid = await hashGitObject(type, content);
				if (actualOid !== oid) {
					throw new Error(
						`repack: object ${oid} failed independent SHA-1 verification ` +
							`(recomputed ${actualOid}) — refusing to trust this read, aborting repack`,
					);
				}
				return { oid, type: type as PackObjectType, content };
			}),
		);
		for (const { oid, type, content } of entries) {
			objects.set(oid, { type, content });
		}
	}
	return objects;
}

/**
 * Default repack threshold. Consolidating is O(total repo object count) —
 * so paying it on every push makes push latency grow with repo size forever.
 */
export const REPACK_PACK_COUNT_THRESHOLD = 4;

async function readPackDirectory(repo: Repo): Promise<PackFileName[]> {
	// An empty repository has no pack directory; any other listing failure
	// must fail the repack, not read as "nothing to consolidate" (#92).
	const entries = await rawFs(repo)
		.readdir(`${repo.gitdir}/objects/pack`)
		.catch((error: unknown) => {
			if (isAbsentError(error)) return [] as string[];
			throw error;
		});
	return parsePackDirectory(entries);
}

/**
 * Every `.keep` in the listing, by pack base name: its `keep-until` date, or
 * `null` for any other content (kept indefinitely, as git does).
 */
async function readKeeps(
	repo: Repo,
	files: PackFileName[],
): Promise<Map<string, Date | null>> {
	const fsp = rawFs(repo);
	const keeps = await Promise.all(
		files
			.filter((file) => file.kind === "keep")
			.map(async (file) => {
				const content = await fsp.readFile(
					`${repo.gitdir}/objects/pack/${file.name}`,
				);
				const until = keepUntilOf(
					typeof content === "string"
						? content
						: new TextDecoder().decode(content),
				);
				return [file.base, until] as const;
			}),
	);
	return new Map(keeps);
}

/** Base names of packs a `.keep` still protects at `now`. */
async function keptPackBases(
	repo: Repo,
	files: PackFileName[],
	now: Date,
): Promise<Set<string>> {
	const kept = new Set<string>();
	for (const [base, until] of await readKeeps(repo, files)) {
		if (until === null || until > now) kept.add(base);
	}
	return kept;
}

/** Delete pack files, indexes first: a reader sees a whole pack or none of it. */
async function unlinkPackFiles(repo: Repo, files: PackFileName[]) {
	const fsp = rawFs(repo);
	const packDir = `${repo.gitdir}/objects/pack`;
	const unlinkAll = (some: PackFileName[]) =>
		Promise.all(
			some.map((file) => fsp.unlink(`${packDir}/${file.name}`).catch(() => {})),
		);
	await unlinkAll(files.filter((file) => file.kind === "idx"));
	await unlinkAll(files.filter((file) => file.kind !== "idx"));
}

/**
 * Merge unexpired `keep-until` packs into one once `threshold` of them have
 * accumulated: objects written ahead of any ref (each its own small pack)
 * would otherwise pile up — every read lists and loads every index — until
 * their keeps expire. The merged pack keeps until the latest expiry among
 * them (at least `keepUntil`). Reads only the kept packs. Returns the
 * gitdir-relative paths it removed. Callers hold the repository lock.
 */
export async function consolidateKeptPacks(
	repo: Repo,
	options: { threshold: number; keepUntil: Date; now?: Date },
): Promise<string[]> {
	const now = options.now ?? new Date();
	const listed = await readPackDirectory(repo);
	const live = [...(await readKeeps(repo, listed))].filter(
		(entry): entry is [string, Date] => entry[1] !== null && entry[1] > now,
	);
	if (live.length < options.threshold) return [];

	const fsp = rawFs(repo);
	const packDir = `${repo.gitdir}/objects/pack`;
	const bases = new Set(live.map(([base]) => base));
	const oids = new Set<string>();
	for (const base of bases) {
		const idx = await fsp.readFile(`${packDir}/${packFileName(base, "idx")}`);
		const entries = idx instanceof Uint8Array ? readPackIndex(idx) : null;
		if (!entries) throw new Error(`consolidate: unreadable index for ${base}`);
		for (const entry of entries) oids.add(entry.oid);
	}
	const wanted = [...oids];
	const packBuffer =
		(await buildPackFromExistingPacks(repo, wanted, bases)) ??
		(await (async () => {
			const objects = await readAndVerifyObjects(repo, wanted);
			return encodePack(wanted.map((oid) => objects.get(oid) as PackObject));
		})());

	const newBase = packBaseName(packBuffer);
	const newPackFile = packFileName(newBase, "pack");
	await fsp.writeFile(`${packDir}/${newPackFile}`, packBuffer);
	const { oids: indexedOids } = await git.indexPack({
		...repo,
		dir: packDir,
		filepath: newPackFile,
	});
	const indexed = new Set(indexedOids);
	if (wanted.some((oid) => !indexed.has(oid))) {
		throw new Error("consolidate: merged pack is missing kept objects");
	}
	const until = new Date(
		Math.max(
			options.keepUntil.getTime(),
			...live.map(([, date]) => date.getTime()),
		),
	);
	await fsp.writeFile(
		`${packDir}/${packFileName(newBase, "keep")}`,
		keepFileContent(until),
	);
	const stale = listed.filter(
		(file) => bases.has(file.base) && file.base !== newBase,
	);
	await unlinkPackFiles(repo, stale);
	return stale.map((file) => `objects/pack/${file.name}`);
}

export interface RepackOptions {
	/** Skip repacking below this many accumulated (unkept) packs. Default 4. */
	threshold?: number;
	/** The time `.keep` expiries are checked against (default: now). */
	now?: Date;
}

/**
 * Consolidate all pack files into one, returning the gitdir-relative paths
 * of the old .pack/.idx files it removed — after syncing the new pack to any
 * secondary storage, delete those same paths there too.
 *
 * A failure rejects rather than being swallowed: whether a failed
 * consolidation is fatal depends on the caller — a post-write repack must
 * not fail an already-durable write, an explicit maintenance repack must
 * report its failure — so the decision belongs at the call site. Leaving a
 * failed run behind is safe (an unconsolidated repo still reads correctly),
 * which is what lets those callers treat it as best-effort.
 */
export async function repackRepository(
	repo: Repo,
	options?: RepackOptions,
	hooks?: HttpHooks,
): Promise<string[]> {
	const threshold = options?.threshold ?? REPACK_PACK_COUNT_THRESHOLD;
	const fsp = rawFs(repo);
	const listed = await readPackDirectory(repo);
	// Kept packs stay as they are, so they don't count towards the threshold:
	// counting them would repack on every write while a keep lasts.
	const kept = await keptPackBases(repo, listed, options?.now ?? new Date());
	const unkept = listed.filter(
		(file) => file.kind === "pack" && !kept.has(file.base),
	);
	if (unkept.length < threshold) {
		return [];
	}

	const [branches, tags] = await Promise.all([
		git.listBranches(repo),
		git.listTags(repo),
	]);
	const refNames = [
		...branches.map((b) => `refs/heads/${b}`),
		...tags.map((t) => `refs/tags/${t}`),
	];
	const tipOids = (
		await Promise.all(
			refNames.map(async (ref) => {
				try {
					return await git.resolveRef({ ...repo, ref });
				} catch (error) {
					// Only a ref that genuinely vanished between list and resolve
					// (nothing reachable from it is worth keeping) may be skipped.
					// Swallowing the rest would drop that ref's history from the
					// consolidated pack and then delete the packs that still held it —
					// leaving the ref dangling after a transient read failure (#91).
					if (isNotFoundError(error)) return null;
					throw error;
				}
			}),
		)
	).filter((oid): oid is string => oid !== null);
	if (tipOids.length === 0) return [];

	// Blobs aren't read here: indexPack below re-hashes every object the
	// new pack holds and the reachable-set check rejects a pack missing any,
	// so inflating every blob in history during the walk too would only
	// double the cost.
	const { oids: reachable, complete } = await collectReachableOids(
		repo,
		tipOids,
		hooks,
		undefined,
		{ verifyBlobs: false },
	);
	if (!complete || reachable.length === 0) return [];

	const packDir = `${repo.gitdir}/objects/pack`;
	// Copy stored entries when everything is packed: keeps deltas, so
	// the consolidated pack is as compact as its sources. Loose objects
	// fall back to a verified, non-deltified rebuild.
	const packBuffer =
		(await buildPackFromExistingPacks(repo, reachable)) ??
		(await (async () => {
			const objects = await readAndVerifyObjects(repo, reachable);
			return encodePack(
				reachable.map((oid) => {
					const object = objects.get(oid);
					if (!object) {
						throw new Error(`repack: missing verified object for ${oid}`);
					}
					return object;
				}),
			);
		})());

	await fsp.mkdir(packDir, { recursive: true });
	const newBase = packBaseName(packBuffer);
	const newPackFile = packFileName(newBase, "pack");
	// Checksum-named, so an identical pack may already be stored — never
	// delete that one on the abort path below.
	const preexisting = (await readPackDirectory(repo)).some(
		(file) => file.base === newBase,
	);
	await fsp.writeFile(`${packDir}/${newPackFile}`, packBuffer);

	const { oids: indexedOids } = await git.indexPack({
		...repo,
		dir: packDir,
		filepath: newPackFile,
	});

	// indexPack re-hashes every object it indexes, so this also verifies
	// the content. Reused packs may carry extra delta bases: superset is fine.
	const indexed = new Set(indexedOids);
	if (reachable.some((oid) => !indexed.has(oid))) {
		if (!preexisting)
			await Promise.all(
				(["pack", "idx"] as const).map((kind) =>
					fsp
						.unlink(`${packDir}/${packFileName(newBase, kind)}`)
						.catch(() => {}),
				),
			);
		throw new Error(
			"repack: indexed pack is missing reachable objects — aborting",
		);
	}

	// An expired `.keep` goes with its pack; unreachable objects in it are
	// dropped now, as git's gc drops them after its grace period.
	const stale = (await readPackDirectory(repo)).filter(
		(file) => file.base !== newBase && !kept.has(file.base),
	);
	// Indexes first: readers find packs through their .idx, so a reader
	// listing mid-cleanup sees either a complete old pack or none of it.
	await unlinkPackFiles(repo, stale);
	return stale.map((file) => `objects/pack/${file.name}`);
}
