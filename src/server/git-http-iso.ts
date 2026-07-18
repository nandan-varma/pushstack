/**
 * Isomorphic-git HTTP backend for upload-pack and receive-pack.
 * Replaces the native-git-binary approach in git-http-backend.ts.
 *
 * upload-pack (clone/fetch): reads directly from R2 via gitFs, no local disk.
 * receive-pack (push): writes incoming pack to /tmp gitdir, then syncs to R2.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import * as localFsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import git, { type FsClient } from "isomorphic-git";
import { bulkDeleteFromR2 } from "#/lib/r2-operations";
import type { GitAuthContext } from "./git-auth";
import { GitAuthorizationError } from "./git-errors";
import {
	detectLooseObjectsHint,
	gitFs,
	invalidateGitStorageKeys,
	invalidateRepoGitStorage,
} from "./git-fs";
import { isSafeFullRefName } from "./git-ref-name";
import { withReceivePackLock } from "./git-repo-storage";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { logError, logWarn, perfContext, perfStep } from "./perf-log";

type GitHttpResult = {
	status: number;
	headers: Record<string, string>;
	body: BodyInit;
};

// --- pkt-line helpers ---

function pktLine(data: string): Buffer {
	const body = Buffer.from(data);
	const len = (body.length + 4).toString(16).padStart(4, "0");
	return Buffer.concat([Buffer.from(len), body]);
}

function pktLineBuffer(body: Buffer): Buffer {
	const len = (body.length + 4).toString(16).padStart(4, "0");
	return Buffer.concat([Buffer.from(len), body]);
}

const FLUSH = Buffer.from("0000");

// Applied to every push ref-update command's client-supplied refName
// *before* it reaches git.resolveRef/deleteRef/writeRef below — see
// isSafeFullRefName's own comment in git-ref-name.ts for why this can't be
// skipped even though git.writeRef validates internally.
const isSafeReceivePackRefName = isSafeFullRefName;

// Per the git protocol, once side-band-64k has been negotiated (see the
// "side-band-64k" capability advertised in handleInfoRefsIso), packfile bytes
// in the upload-pack response must be chunked into pkt-lines each prefixed
// with a control byte (0x01 = packfile data), terminated by a flush-pkt.
// Without this, clients that don't special-case "no side-band" — e.g.
// isomorphic-git's GitSideBand.demux, which always treats the response as
// side-band-framed regardless of what was negotiated — misparse the raw
// packfile bytes as bogus pkt-line length headers and spin forever. Real
// native `git` tolerates a raw, unframed packfile stream when side-band
// isn't negotiated, which is why this only surfaced once a test started
// using isomorphic-git itself as the HTTP client.
const SIDE_BAND_MAX_CHUNK = 65515;

function sideBandPackfile(packData: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (
		let offset = 0;
		offset < packData.length;
		offset += SIDE_BAND_MAX_CHUNK
	) {
		const chunk = packData.subarray(offset, offset + SIDE_BAND_MAX_CHUNK);
		parts.push(pktLineBuffer(Buffer.concat([Buffer.from([1]), chunk])));
	}
	parts.push(FLUSH);
	return Buffer.concat(parts);
}

function parsePktLines(buf: Buffer): Array<string | null> {
	const lines: Array<string | null> = [];
	let pos = 0;
	while (pos + 4 <= buf.length) {
		const len = Number.parseInt(buf.slice(pos, pos + 4).toString("ascii"), 16);
		if (len === 0) {
			lines.push(null);
			pos += 4;
		} else if (len >= 4) {
			lines.push(buf.slice(pos + 4, pos + len).toString("utf8"));
			pos += len;
		} else {
			break;
		}
	}
	return lines;
}

// --- ref listing ---

async function listAllRefs(gitdir: string, defaultBranch = "main") {
	// Fetch branch/tag lists and HEAD in parallel
	const [branches, tags, headOid, headSymref] = await Promise.all([
		git.listBranches({ fs: gitFs, gitdir }),
		git.listTags({ fs: gitFs, gitdir }),
		git.resolveRef({ fs: gitFs, gitdir, ref: "HEAD" }).catch(() => null),
		// Wrap with Promise.resolve so a mock/stub returning undefined doesn't crash .then()
		Promise.resolve(git.currentBranch({ fs: gitFs, gitdir, fullname: true }))
			.then((cb) => cb ?? `refs/heads/${defaultBranch}`)
			.catch(() => `refs/heads/${defaultBranch}`),
	]);

	// Resolve all branch and tag OIDs in parallel
	const [branchRefs, tagRefs] = await Promise.all([
		Promise.all(
			branches.map(async (branch) => {
				try {
					const oid = await git.resolveRef({
						fs: gitFs,
						gitdir,
						ref: `refs/heads/${branch}`,
					});
					return { name: `refs/heads/${branch}`, oid };
				} catch {
					return null;
				}
			}),
		),
		Promise.all(
			tags.map(async (tag) => {
				try {
					const oid = await git.resolveRef({
						fs: gitFs,
						gitdir,
						ref: `refs/tags/${tag}`,
					});
					return { name: `refs/tags/${tag}`, oid };
				} catch {
					return null;
				}
			}),
		),
	]);

	const refs: Array<{ name: string; oid: string }> = [];
	if (headOid) refs.push({ name: "HEAD", oid: headOid });
	for (const r of branchRefs) if (r) refs.push(r);
	for (const r of tagRefs) if (r) refs.push(r);

	return { refs, headSymref };
}

// --- object graph traversal ---

interface ReachabilityResult {
	oids: string[];
	// False if any object in the graph couldn't be read — repackLocal uses this
	// (not a raw object-count comparison) to decide whether it's safe to delete
	// old packs: see the comment on that check for why counts alone are unreliable.
	complete: boolean;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// A read landing in the gap between repackLocal's new consolidated pack being
// uploaded and deleteStalePacksFromR2 finishing its cleanup (+ its own cache
// invalidation, see that function's comment) can transiently 404 on an object
// that is not actually lost — it exists in the new pack the whole time, this
// request's cached objects/pack/ listing was just taken before that pack
// existed (or after the old one it names was already deleted). Reproduced
// directly: 9 of 15 clones run concurrently against a repo being repeatedly
// pushed to (each push crossing the repack threshold) failed with "remote did
// not send all necessary objects" for the exact same oid that a moment later
// (or a moment earlier) cloned fine. One retry after a short delay — long
// enough for that cleanup's own cache invalidation to have landed — is enough
// to observe the current, consistent pack listing instead of the mid-transition
// snapshot the first attempt raced against.
const MISSING_OBJECT_RETRY_DELAY_MS = 200;

// ponytail: filesystem param lets this run against R2 (clone) or local disk (repack after push)
async function collectReachableOids(
	gitdir: string,
	startOids: string[],
	filesystem: FsClient = gitFs,
): Promise<ReachabilityResult> {
	const seen = new Set<string>();
	let complete = true;
	// ponytail: promise-per-oid deduplicates concurrent traversal paths
	const promises = new Map<string, Promise<void>>();

	async function readAndVisitChildren(oid: string): Promise<void> {
		const obj = await git.readObject({ fs: filesystem, gitdir, oid });
		// Add to seen only after a successful read so failed reads are excluded from the pack
		seen.add(oid);
		let children: string[] = [];
		if (obj.type === "commit") {
			const { commit } = await git.readCommit({ fs: filesystem, gitdir, oid });
			children = [commit.tree, ...commit.parent];
		} else if (obj.type === "tree") {
			const { tree } = await git.readTree({ fs: filesystem, gitdir, oid });
			children = tree.map((e) => e.oid);
		} else if (obj.type === "tag") {
			const { tag } = await git.readTag({ fs: filesystem, gitdir, oid });
			children = [tag.object];
		}
		await Promise.all(children.map(visit));
	}

	function visit(oid: string): Promise<void> {
		const existing = promises.get(oid);
		if (existing) return existing;

		const p = (async () => {
			try {
				await readAndVisitChildren(oid);
			} catch {
				try {
					await delay(MISSING_OBJECT_RETRY_DELAY_MS);
					await readAndVisitChildren(oid);
				} catch (err) {
					complete = false;
					logWarn("git-http", `missing object ${oid}`, err);
				}
			}
		})();

		promises.set(oid, p);
		return p;
	}

	await Promise.all(startOids.map(visit));
	return { oids: Array.from(seen), complete };
}

// ponytail: repack threshold. Consolidating is O(total repo object count) — reachability
// traversal + a full packObjects + indexPack over *everything*, not just what this push
// added — so paying that cost on every single push makes push latency grow with total
// repo size forever, not with the size of the just-pushed delta. Below this many packs,
// clone/fetch's own O(1)-ish pack search (isomorphic-git checks each pack's index) is
// already cheap enough that consolidating isn't worth a full push's extra latency; skip
// it and let the next call re-check once enough small pushes have piled up packs.
const REPACK_PACK_COUNT_THRESHOLD = 4;

async function countLocalPacks(localGitdir: string): Promise<number> {
	try {
		const entries = await localFsPromises.readdir(
			path.join(localGitdir, "objects", "pack"),
		);
		return entries.filter((f) => f.endsWith(".pack")).length;
	} catch {
		return 0;
	}
}

const deflateAsync = promisify(zlib.deflate);

type PackObjectType = "commit" | "tree" | "blob" | "tag";

// Git pack object type bits (bits 6-4 of the header's first byte) — same
// constants real git and isomorphic-git's own (de)serializers use.
const PACK_OBJECT_TYPE_BITS: Record<PackObjectType, number> = {
	commit: 0b0010000,
	tree: 0b0100000,
	blob: 0b0110000,
	tag: 0b1000000,
};

// Git's pack object header: first byte packs (continuation bit | 3-bit type |
// low 4 bits of length); any remaining length is emitted 7 bits at a time,
// each with its own continuation bit, little-endian. Written directly as
// bytes (not via isomorphic-git's own hex-string round trip in `_pack`,
// which can drop a byte when a continuation byte's value is < 0x10).
function encodePackObjectHeader(type: PackObjectType, length: number): Buffer {
	const bytes: number[] = [];
	let more = length > 0b1111;
	bytes.push(
		(more ? 0b10000000 : 0) | PACK_OBJECT_TYPE_BITS[type] | (length & 0b1111),
	);
	length >>>= 4;
	while (more) {
		more = length > 0b01111111;
		bytes.push((more ? 0b10000000 : 0) | (length & 0b01111111));
		length >>>= 7;
	}
	return Buffer.from(bytes);
}

// Git's object hash: sha1("<type> <byte length>\0<content>") — matches
// isomorphic-git's internal GitObject.wrap + shasum, computed independently
// here rather than trusted from isomorphic-git's own read path (see below).
function hashGitObject(type: string, content: Buffer): string {
	return createHash("sha1")
		.update(`${type} ${content.length}\0`)
		.update(content)
		.digest("hex");
}

type VerifiedObject = { type: PackObjectType; content: Buffer };

// Reads every reachable object and independently re-derives its oid from the
// bytes isomorphic-git handed back, instead of trusting the oid it was asked
// for. This exists because isomorphic-git's *packed*-object read path
// (readObjectPacked -> GitPackIndex.readSlice, which resolves ofs/ref deltas,
// possibly across pack files via getExternalRefDelta) never verifies the
// resolved content's SHA-1 against the requested oid — only the loose-object
// branch of _readObject does that. A full reachability walk (what repacking
// requires) is exactly the operation most likely to touch objects nothing
// else ever reads, so a latent cross-pack delta-resolution bug would surface
// here first, silently, unless we check for it ourselves.
async function readAndVerifyObjects(
	gitdir: string,
	oids: string[],
): Promise<Map<string, VerifiedObject>> {
	const objects = new Map<string, VerifiedObject>();
	const BATCH_SIZE = 100;
	for (let i = 0; i < oids.length; i += BATCH_SIZE) {
		const batch = oids.slice(i, i + BATCH_SIZE);
		const entries = await Promise.all(
			batch.map(async (oid) => {
				const { type, object } = await git.readObject({
					fs,
					gitdir,
					oid,
					format: "content",
				});
				const content = Buffer.isBuffer(object)
					? object
					: Buffer.from(object as Uint8Array);
				const actualOid = hashGitObject(type, content);
				if (actualOid !== oid) {
					throw new Error(
						`repackLocal: object ${oid} failed independent SHA-1 verification ` +
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

// Serializes verified objects into a pack containing only full (never
// deltified) entries, in the given oid order. zlib (native, threadpool-backed)
// runs in bounded-concurrency batches rather than isomorphic-git's own fully
// serial per-object loop.
async function buildVerifiedPack(
	oids: string[],
	objects: Map<string, VerifiedObject>,
): Promise<Buffer> {
	const header = Buffer.alloc(12);
	header.write("PACK", 0, "ascii");
	header.writeUInt32BE(2, 4);
	header.writeUInt32BE(oids.length, 8);

	const chunks: Buffer[] = [header];
	const hash = createHash("sha1").update(header);

	const BATCH_SIZE = 100;
	for (let i = 0; i < oids.length; i += BATCH_SIZE) {
		const batch = oids.slice(i, i + BATCH_SIZE);
		const encoded = await Promise.all(
			batch.map(async (oid) => {
				const entry = objects.get(oid);
				if (!entry) {
					throw new Error(`repackLocal: missing verified object for ${oid}`);
				}
				const objHeader = encodePackObjectHeader(
					entry.type,
					entry.content.length,
				);
				const compressed = await deflateAsync(entry.content);
				return Buffer.concat([objHeader, compressed]);
			}),
		);
		for (const buf of encoded) {
			chunks.push(buf);
			hash.update(buf);
		}
	}

	chunks.push(hash.digest());
	return Buffer.concat(chunks);
}

// Consolidate all pack files into one after a push so R2 doesn't accumulate one new
// pack file per push forever. Returns the gitdir-relative paths of any old .pack/.idx
// files this removed *locally* — syncRepositoryToR2Unlocked never deletes anything
// under objects/ (git objects are content-addressed and assumed immutable/safe to
// keep), so the caller must explicitly delete these same paths from R2 too (see
// deleteStalePacksFromR2, below) or the old packs it just proved redundant live on
// in R2 forever, exactly as unconsolidated as before — this used to be silently true
// here: the local repack succeeded every time, but nothing ever told R2 about the
// packs it had just made redundant.
//
// This used to shell out to real `git rev-list`/`git pack-objects`, because
// isomorphic-git's delta resolution once silently produced pack indexes with
// unresolvable/wrong delta references once a repo had multiple accumulated
// packs — reading isomorphic-git's own source tracked this to a real gap:
// readObjectPacked's delta-resolved reads never verify the result's SHA-1
// against the requested oid (only loose-object reads do). Rather than
// re-trusting that path, this repacks by reading + independently
// SHA-1-verifying every reachable object ourselves (readAndVerifyObjects,
// above) and writing a pack of exclusively full, non-deltified objects
// (buildVerifiedPack) — which also means indexing the result below can't hit
// the suspect cross-pack delta-resolution code at all, since there are no
// deltas in it to resolve.
async function repackLocal(localGitdir: string): Promise<string[]> {
	try {
		if ((await countLocalPacks(localGitdir)) < REPACK_PACK_COUNT_THRESHOLD) {
			return [];
		}

		const [branches, tags] = await Promise.all([
			git.listBranches({ fs, gitdir: localGitdir }),
			git.listTags({ fs, gitdir: localGitdir }),
		]);
		const refNames = [
			...branches.map((b) => `refs/heads/${b}`),
			...tags.map((t) => `refs/tags/${t}`),
		];
		const tipOids = (
			await Promise.all(
				refNames.map((ref) =>
					git.resolveRef({ fs, gitdir: localGitdir, ref }).catch(() => null),
				),
			)
		).filter((oid): oid is string => oid !== null);
		if (tipOids.length === 0) return [];

		const { oids, complete } = await collectReachableOids(
			localGitdir,
			tipOids,
			fs,
		);
		if (!complete || oids.length === 0) return [];

		const objects = await readAndVerifyObjects(localGitdir, oids);
		const packBuffer = await buildVerifiedPack(oids, objects);

		const packDir = path.join(localGitdir, "objects", "pack");
		await localFsPromises.mkdir(packDir, { recursive: true });
		const newBase = `pack-${Date.now()}`;
		const newPackFile = `${newBase}.pack`;
		const newIdxFile = `${newBase}.idx`;
		await localFsPromises.writeFile(
			path.join(packDir, newPackFile),
			packBuffer,
		);

		// Indexing a pack with zero deltas never touches the cross-pack
		// delta-resolution path this function exists to avoid — safe to reuse
		// the same isomorphic-git primitive already trusted for incoming push
		// packs (see handleReceivePackIso, below).
		const { oids: indexedOids } = await git.indexPack({
			fs,
			dir: packDir,
			gitdir: localGitdir,
			filepath: newPackFile,
		});

		// Cross-check: the freshly-built index must describe exactly the
		// verified object set, no more, no less, before anything old is deleted.
		const expected = new Set(oids);
		const indexed = new Set(indexedOids);
		if (
			indexed.size !== expected.size ||
			oids.some((oid) => !indexed.has(oid))
		) {
			await localFsPromises
				.unlink(path.join(packDir, newPackFile))
				.catch(() => {});
			await localFsPromises
				.unlink(path.join(packDir, newIdxFile))
				.catch(() => {});
			throw new Error(
				"repackLocal: indexed pack's oid set didn't match the verified reachable set — aborting",
			);
		}

		const allEntries: string[] = await localFsPromises
			.readdir(packDir)
			.catch(() => []);

		const staleFiles = allEntries.filter(
			(f) =>
				f !== newPackFile &&
				f !== newIdxFile &&
				(f.endsWith(".pack") || f.endsWith(".idx") || f.endsWith(".keep")),
		);

		await Promise.all(
			staleFiles.map((f) =>
				localFsPromises.unlink(path.join(packDir, f)).catch(() => {}),
			),
		);

		return staleFiles.map((f) => `objects/pack/${f}`);
	} catch (err) {
		// Repack failure is non-fatal — the push still succeeded, just with an extra pack file
		logError("git-http", "repack failed (non-fatal)", err);
		return [];
	}
}

// repackLocal only removes pack/idx files *locally* (see its own comment) —
// this is the other half, shared by the live push path (handleReceivePackIso)
// and repackRepositoryNow (the standalone maintenance entry point below): it
// deletes the same gitdir-relative paths from R2 and invalidates the caches
// that would otherwise keep serving the now-deleted names.
async function deleteStalePacksFromR2(
	ownerKey: string,
	repoName: string,
	staleRelativePaths: string[],
): Promise<void> {
	if (staleRelativePaths.length === 0) return;
	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	await bulkDeleteFromR2(staleRelativePaths.map((p) => `${prefix}${p}`)).catch(
		(err: unknown) => {
			logError(
				"git-http",
				"failed to delete superseded packs from R2 (non-fatal)",
				err,
			);
		},
	);
	// The repo's cached listings were already invalidated once by
	// syncRepositoryToR2 (before these deletes ran) — invalidate again so a
	// concurrent readdir can't have repopulated them with the now-stale names in
	// the gap between that invalidation and this delete.
	invalidateRepoGitStorage(ownerKey, repoName);
	invalidateGitStorageKeys(staleRelativePaths.map((p) => `${prefix}${p}`));
}

/**
 * Consolidates a repository's packs on demand, outside of a live push —
 * for clearing a backlog that accumulated before REPACK_PACK_COUNT_THRESHOLD
 * (or the R2 cleanup step in deleteStalePacksFromR2) existed, on a repo that
 * won't otherwise get a repack until its next push crosses the threshold
 * again. Runs the same repackLocal + R2 cleanup a real push triggers, via its
 * own hydrate/sync cycle rather than piggybacking on an in-flight push's.
 */
export async function repackRepositoryNow(
	ownerKey: string,
	repoName: string,
	defaultBranch = "main",
	ownerDbId?: string,
): Promise<{ removedPacks: number }> {
	let staleRepackedPaths: string[] = [];
	await withReceivePackLock(
		ownerKey,
		repoName,
		defaultBranch,
		async (localGitdir) => {
			staleRepackedPaths = await repackLocal(localGitdir);
			return null;
		},
		ownerDbId,
	);
	await deleteStalePacksFromR2(ownerKey, repoName, staleRepackedPaths);
	return { removedPacks: staleRepackedPaths.length };
}

// --- info/refs ---

export async function handleInfoRefsIso(
	ownerKey: string,
	repoName: string,
	service: "git-upload-pack" | "git-receive-pack",
	authContext: GitAuthContext,
	defaultBranch = "main",
): Promise<GitHttpResult> {
	return perfContext(
		`infoRefs ${ownerKey}/${repoName} ${service}`,
		async () => {
			if (service === "git-upload-pack" && !authContext.canRead) {
				throw new GitAuthorizationError(
					"Access denied: insufficient read permissions",
				);
			}
			if (service === "git-receive-pack" && !authContext.canWrite) {
				throw new GitAuthorizationError(
					"Access denied: insufficient write permissions",
				);
			}

			const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
			const { refs, headSymref } = await perfStep("listAllRefs", () =>
				listAllRefs(gitdir, defaultBranch),
			);

			const isUpload = service === "git-upload-pack";
			// side-band-64k: advertised (and honored below in
			// handleUploadPackIsoInner) so clients that unconditionally expect
			// side-band framing on the response — e.g. isomorphic-git — don't
			// misparse a raw packfile stream. See sideBandPackfile's comment.
			const caps = isUpload
				? `no-progress side-band-64k symref=HEAD:${headSymref} allow-tip-sha1-in-want allow-reachable-sha1-in-want agent=pushstack/1.0`
				: `delete-refs report-status no-done agent=pushstack/1.0`;

			const parts: Buffer[] = [pktLine(`# service=${service}\n`), FLUSH];

			if (refs.length === 0) {
				// Empty repo: git needs this exact sentinel
				parts.push(
					pktLine(
						`0000000000000000000000000000000000000000 capabilities^{}\0${caps}\n`,
					),
				);
			} else {
				let first = true;
				for (const { name, oid } of refs) {
					parts.push(
						pktLine(first ? `${oid} ${name}\0${caps}\n` : `${oid} ${name}\n`),
					);
					first = false;
				}
			}
			parts.push(FLUSH);

			return {
				status: 200,
				headers: {
					"Content-Type": `application/x-${service}-advertisement`,
					"Cache-Control": "no-cache",
				},
				body: Buffer.concat(parts),
			};
		},
	);
}

// --- upload-pack (clone/fetch) ---

export async function handleUploadPackIso(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
): Promise<GitHttpResult> {
	return perfContext(`uploadPack ${ownerKey}/${repoName}`, () =>
		handleUploadPackIsoInner(ownerKey, repoName, request, authContext),
	);
}

async function handleUploadPackIsoInner(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
): Promise<GitHttpResult> {
	if (!authContext.canRead) {
		throw new GitAuthorizationError(
			"Access denied: insufficient read permissions",
		);
	}

	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	const body = Buffer.from(await request.arrayBuffer());
	const lines = parsePktLines(body);

	const wants: string[] = [];
	const haves: string[] = [];
	let done = false;
	for (const line of lines) {
		if (!line) continue;
		// "want <sha1>" or "want <sha1> <capabilities>" (first line only, NUL-separated)
		if (line.startsWith("want ")) {
			wants.push(line.slice(5, 45));
		}
		// "have <sha1>"
		if (line.startsWith("have ")) {
			const sha = line.slice(5, 45);
			if (sha !== "0000000000000000000000000000000000000000") {
				haves.push(sha);
			}
		}
		if (line.startsWith("done")) {
			done = true;
		}
	}

	if (wants.length === 0) {
		return {
			status: 200,
			headers: { "Content-Type": "application/x-git-upload-pack-result" },
			body: Buffer.concat([pktLine("NAK\n")]),
		};
	}

	// We don't implement multi-round negotiation (no multi_ack in our advertised
	// capabilities), so per protocol the client drives it: it may send several
	// "have" batches expecting a bare NAK each time, and only the batch carrying
	// "done" should get the packfile. Sending the pack on a non-final round makes
	// the client's pkt-line parser choke on the raw "PACK..." bytes it wasn't
	// expecting yet ("protocol error: bad line length character: PACK").
	if (haves.length > 0 && !done) {
		return {
			status: 200,
			headers: { "Content-Type": "application/x-git-upload-pack-result" },
			body: Buffer.concat([pktLine("NAK\n")]),
		};
	}

	// ponytail: fresh clone = no haves, so we need all objects. When the repo is down
	// to a single pack (repackLocal only consolidates once REPACK_PACK_COUNT_THRESHOLD
	// packs have accumulated, not after every push — see git-http-iso.ts's repackLocal),
	// that one pack already contains exactly the full reachable object set — serve it
	// directly and skip the O(N-objects) traversal + repack entirely. With more than one
	// pack present this falls through to the general path below instead.
	if (haves.length === 0) {
		const packDirPath = `${gitdir}/objects/pack`;
		const entries = await perfStep("readdir objects/pack", () =>
			gitFs.promises.readdir(packDirPath).catch(() => []),
		);
		const packNames = entries.filter((f) => f.endsWith(".pack"));
		if (packNames.length === 1) {
			const packData = await perfStep(
				"read consolidated pack (fast path)",
				() => gitFs.promises.readFile(`${packDirPath}/${packNames[0]}`),
			);
			return {
				status: 200,
				headers: {
					"Content-Type": "application/x-git-upload-pack-result",
					"Cache-Control": "no-cache",
				},
				body: Buffer.concat([
					pktLine("NAK\n"),
					sideBandPackfile(
						Buffer.isBuffer(packData)
							? packData
							: Buffer.from(packData as Uint8Array),
					),
				]),
			};
		}
	}

	// Most repos are fully packed — without this, every object collectReachableOids
	// touches below pays a doomed loose-object GET before falling back to the pack
	// search, since (unlike the single-pack fast path above) this general path always
	// runs a full reachability walk. This previously only ran from the commit-log
	// browsing path (getCommitLog's prefetchAllPacks), never from here — meaning
	// every real `git clone`/`git fetch` that didn't hit the single-pack fast path
	// (any repo with more than one accumulated pack) paid the full per-object tax.
	await perfStep("detectLooseObjectsHint", () =>
		detectLooseObjectsHint(ownerKey, repoName),
	);

	const { oids: wantOids } = await perfStep("collectReachableOids(wants)", () =>
		collectReachableOids(gitdir, wants),
	);
	let oids = wantOids;
	if (haves.length > 0) {
		const { oids: haveOidsList } = await perfStep(
			"collectReachableOids(haves)",
			() => collectReachableOids(gitdir, haves),
		);
		const haveOids = new Set(haveOidsList);
		oids = wantOids.filter((oid) => !haveOids.has(oid));
	}

	const { packfile } = await perfStep("packObjects", () =>
		git.packObjects({ fs: gitFs, gitdir, oids }),
	);

	return {
		status: 200,
		headers: {
			"Content-Type": "application/x-git-upload-pack-result",
			"Cache-Control": "no-cache",
		},
		body: Buffer.concat([
			pktLine("NAK\n"),
			sideBandPackfile(Buffer.from(packfile ?? new Uint8Array())),
		]),
	};
}

// --- receive-pack (push) ---

export async function handleReceivePackIso(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
	defaultBranch = "main",
	ownerDbId?: string,
): Promise<GitHttpResult> {
	return perfContext(`receivePack ${ownerKey}/${repoName}`, () =>
		handleReceivePackIsoInner(
			ownerKey,
			repoName,
			request,
			authContext,
			defaultBranch,
			ownerDbId,
		),
	);
}

async function handleReceivePackIsoInner(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
	defaultBranch = "main",
	ownerDbId?: string,
): Promise<GitHttpResult> {
	if (!authContext.canWrite) {
		throw new GitAuthorizationError(
			"Access denied: insufficient write permissions",
		);
	}

	const body = Buffer.from(await request.arrayBuffer());

	// Split the body: pkt-line ref update commands, then flush, then raw PACK
	const refUpdates: Array<{
		oldOid: string;
		newOid: string;
		refName: string;
	}> = [];
	let pos = 0;
	while (pos + 4 <= body.length) {
		const len = Number.parseInt(body.slice(pos, pos + 4).toString("ascii"), 16);
		if (len === 0) {
			pos += 4;
			break; // flush = end of ref update commands
		}
		if (len < 4) break;
		// Strip NUL-separated capabilities from the first command line
		const line = body
			.slice(pos + 4, pos + len)
			.toString("utf8")
			.replace(/\n$/, "")
			.split("\0")[0];
		pos += len;
		const parts = line.split(" ");
		if (parts.length >= 3) {
			refUpdates.push({
				oldOid: parts[0],
				newOid: parts[1],
				refName: parts[2],
			});
		}
	}
	const packData = body.slice(pos);

	// Populated inside the locked closure below by repackLocal — deleted *locally*
	// there, but only actually removable from R2 once withReceivePackLock's automatic
	// sync has uploaded the new consolidated pack that replaces them (see the
	// deletion after the lock resolves, below).
	let staleRepackedPaths: string[] = [];

	const refUpdateResults = await withReceivePackLock(
		ownerKey,
		repoName,
		defaultBranch,
		async (localGitdir) => {
			// ensureRepositoryHydrated may return a path that was inited in R2 but not on
			// local disk. git.writeRef and indexPack need refs/heads/ and objects/ to exist locally.
			try {
				await localFsPromises.access(path.join(localGitdir, "HEAD"));
			} catch {
				await localFsPromises.mkdir(localGitdir, { recursive: true });
				await git.init({ fs, dir: localGitdir, defaultBranch, bare: true });
			}

			// Write incoming PACK into objects/pack/ so indexPack can process it there
			if (packData.length >= 4) {
				await perfStep("write + indexPack incoming pack", async () => {
					const packDir = path.join(localGitdir, "objects", "pack");
					await localFsPromises.mkdir(packDir, { recursive: true });

					const packName = `pushstack-recv-${Date.now()}`;
					await localFsPromises.writeFile(
						path.join(packDir, `${packName}.pack`),
						packData,
					);

					// Index the pack (writes .idx next to .pack, resolves external deltas from gitdir)
					await git.indexPack({
						fs,
						dir: packDir,
						gitdir: localGitdir,
						filepath: `${packName}.pack`,
					});
				});
			}

			// Update refs, enforcing compare-and-swap against each command's claimed
			// oldOid so a push whose base moved since the client last fetched (another
			// push landed first) is rejected instead of force-overwriting the ref and
			// silently discarding the other push's commits. Each ref update only touches
			// its own ref file, so a multi-ref push (e.g. `git push --all`/`--tags`)
			// applies them all in parallel instead of one at a time.
			const ZERO_OID = "0".repeat(40);
			const results = await perfStep("apply ref updates", () =>
				Promise.all(
					refUpdates.map(async ({ oldOid, newOid, refName }) => {
						// Reject before any filesystem call reads or writes through
						// this refName — see isSafeReceivePackRefName's comment.
						if (!isSafeReceivePackRefName(refName)) {
							return {
								refName,
								ok: false,
								reason: "invalid ref name",
							};
						}

						const currentOid = await git
							.resolveRef({ fs, gitdir: localGitdir, ref: refName })
							.catch(() => ZERO_OID);

						if (currentOid !== oldOid) {
							return {
								refName,
								ok: false,
								reason: "non-fast-forward, ref updated by another push",
							};
						}

						if (newOid === ZERO_OID) {
							await git
								.deleteRef({ fs, gitdir: localGitdir, ref: refName })
								.catch(() => {});
						} else {
							await git.writeRef({
								fs,
								gitdir: localGitdir,
								ref: refName,
								value: newOid,
								force: true,
							});
						}
						return { refName, ok: true };
					}),
				),
			);

			staleRepackedPaths = await perfStep("repackLocal", () =>
				repackLocal(localGitdir),
			);
			return results;
		},
		ownerDbId,
	);

	// The new consolidated pack is a normal new local file, so withReceivePackLock's
	// automatic syncRepositoryToR2Unlocked already uploaded it — but that same sync
	// deliberately never deletes anything under objects/ in R2 (git objects are
	// content-addressed and assumed safe to keep). repackLocal already proved these
	// specific old packs are redundant (reachability-completeness check), so it's
	// safe — and necessary — to explicitly remove them from R2 here, now that the
	// replacement pack they're redundant with is confirmed uploaded. Skipping this
	// is what let every push leave one more permanent pack file in R2 forever.
	await deleteStalePacksFromR2(ownerKey, repoName, staleRepackedPaths);

	const responseBody = Buffer.concat([
		pktLine("unpack ok\n"),
		...refUpdateResults.map(({ refName, ok, reason }) =>
			pktLine(ok ? `ok ${refName}\n` : `ng ${refName} ${reason}\n`),
		),
		FLUSH,
	]);

	return {
		status: 200,
		headers: {
			"Content-Type": "application/x-git-receive-pack-result",
			"Cache-Control": "no-cache",
		},
		body: responseBody,
	};
}
