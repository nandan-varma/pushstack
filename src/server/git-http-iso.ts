/**
 * Isomorphic-git HTTP backend for upload-pack and receive-pack.
 * Replaces the native-git-binary approach in git-http-backend.ts.
 *
 * upload-pack (clone/fetch): reads directly from R2 via r2Backend, no local disk.
 * receive-pack (push): writes incoming pack to /tmp gitdir, then syncs to R2.
 */

import fs from "node:fs";
import * as localFsPromises from "node:fs/promises";
import path from "node:path";
import git, { type FsClient } from "isomorphic-git";
import { bulkDeleteFromR2 } from "#/lib/r2-operations";
import type { GitAuthContext } from "./git-auth";
import { deleteCache, invalidateCache } from "./git-cache";
import { GitAuthorizationError } from "./git-errors";
import { r2Backend } from "./git-r2-backend";
import { withReceivePackLock } from "./git-repo-storage";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { perfContext, perfStep } from "./perf-log";

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

const FLUSH = Buffer.from("0000");

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
		git.listBranches({ fs: r2Backend, gitdir }),
		git.listTags({ fs: r2Backend, gitdir }),
		git.resolveRef({ fs: r2Backend, gitdir, ref: "HEAD" }).catch(() => null),
		// Wrap with Promise.resolve so a mock/stub returning undefined doesn't crash .then()
		Promise.resolve(
			git.currentBranch({ fs: r2Backend, gitdir, fullname: true }),
		)
			.then((cb) => cb ?? `refs/heads/${defaultBranch}`)
			.catch(() => `refs/heads/${defaultBranch}`),
	]);

	// Resolve all branch and tag OIDs in parallel
	const [branchRefs, tagRefs] = await Promise.all([
		Promise.all(
			branches.map(async (branch) => {
				try {
					const oid = await git.resolveRef({
						fs: r2Backend,
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
						fs: r2Backend,
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

// ponytail: filesystem param lets this run against R2 (clone) or local disk (repack after push)
async function collectReachableOids(
	gitdir: string,
	startOids: string[],
	filesystem: FsClient = r2Backend,
): Promise<ReachabilityResult> {
	const seen = new Set<string>();
	let complete = true;
	// ponytail: promise-per-oid deduplicates concurrent traversal paths
	const promises = new Map<string, Promise<void>>();

	function visit(oid: string): Promise<void> {
		const existing = promises.get(oid);
		if (existing) return existing;

		const p = (async () => {
			try {
				const obj = await git.readObject({ fs: filesystem, gitdir, oid });
				// Add to seen only after a successful read so failed reads are excluded from the pack
				seen.add(oid);
				let children: string[] = [];
				if (obj.type === "commit") {
					const { commit } = await git.readCommit({
						fs: filesystem,
						gitdir,
						oid,
					});
					children = [commit.tree, ...commit.parent];
				} else if (obj.type === "tree") {
					const { tree } = await git.readTree({ fs: filesystem, gitdir, oid });
					children = tree.map((e) => e.oid);
				} else if (obj.type === "tag") {
					const { tag } = await git.readTag({ fs: filesystem, gitdir, oid });
					children = [tag.object];
				}
				await Promise.all(children.map(visit));
			} catch (err) {
				complete = false;
				console.warn(
					`[git-http] missing object ${oid}:`,
					err instanceof Error ? err.message : err,
				);
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

// Consolidate all pack files into one after a push so R2 doesn't accumulate one new
// pack file per push forever. Returns the gitdir-relative paths of any old .pack/.idx
// files this removed *locally* — syncRepositoryToR2Unlocked never deletes anything
// under objects/ (git objects are content-addressed and assumed immutable/safe to
// keep), so the caller must explicitly delete these same paths from R2 too, or the
// old packs it just proved redundant (via the object-count safety check below) live
// on in R2 forever, exactly as unconsolidated as before — this used to be silently
// true here: the local repack succeeded every time, but nothing ever told R2 about
// the packs it had just made redundant.
async function repackLocal(localGitdir: string): Promise<string[]> {
	try {
		if ((await countLocalPacks(localGitdir)) < REPACK_PACK_COUNT_THRESHOLD) {
			return [];
		}

		// Null-coalesce to [] so a mock/stub returning undefined never crashes .map()
		const branches: string[] =
			(await Promise.resolve(
				git.listBranches({ fs, gitdir: localGitdir }),
			).catch(() => null)) ?? [];
		const tags: string[] =
			(await Promise.resolve(git.listTags({ fs, gitdir: localGitdir })).catch(
				() => null,
			)) ?? [];

		const tipOids = (
			await Promise.all([
				...branches.map((b) =>
					git
						.resolveRef({ fs, gitdir: localGitdir, ref: `refs/heads/${b}` })
						.catch(() => null),
				),
				...tags.map((t) =>
					git
						.resolveRef({ fs, gitdir: localGitdir, ref: `refs/tags/${t}` })
						.catch(() => null),
				),
			])
		).filter((oid): oid is string => oid !== null);

		if (tipOids.length === 0) return [];

		const { oids: allOids, complete } = await collectReachableOids(
			localGitdir,
			tipOids,
			fs,
		);
		if (allOids.length === 0) return [];

		// Guard against data loss: only delete old packs if the reachability traversal
		// above actually read every object it visited. A raw object-count comparison
		// (new consolidated pack vs. sum of old packs) doesn't work as a safety check
		// here: the moment packs ever overlap in content — which happens as soon as an
		// earlier repack's own safety check ever declined to clean up — the "old" side
		// double-counts objects present in more than one old pack, so it almost always
		// comes out higher than the new deduplicated count. That made this check
		// permanently refuse to ever consolidate again once it failed once (exactly
		// what was observed: pack counts climbing indefinitely across many pushes).
		// Traversal completeness is the actual property that matters — nothing
		// reachable was missed — so check that directly instead of inferring it from
		// counts that assumption doesn't hold for.
		if (!complete) {
			console.warn(
				"[git-http] repack: keeping old packs (reachability traversal was incomplete)",
			);
			return [];
		}

		const { packfile } = await git.packObjects({
			fs,
			gitdir: localGitdir,
			oids: allOids,
		});
		if (!packfile) return [];

		const packDir = path.join(localGitdir, "objects", "pack");
		const newName = `pack-${Date.now()}`;
		await localFsPromises.writeFile(
			path.join(packDir, `${newName}.pack`),
			Buffer.from(packfile),
		);
		await git.indexPack({
			fs,
			dir: packDir,
			gitdir: localGitdir,
			filepath: `${newName}.pack`,
		});

		const allEntries: string[] = await Promise.resolve()
			.then(() => localFsPromises.readdir(packDir))
			.catch(() => []);

		const staleFiles = allEntries.filter(
			(f) =>
				f !== `${newName}.pack` &&
				f !== `${newName}.idx` &&
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
		console.error("[git-http] repack failed (non-fatal):", err);
		return [];
	}
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
			const caps = isUpload
				? `no-progress symref=HEAD:${headSymref} allow-tip-sha1-in-want allow-reachable-sha1-in-want agent=pushstack/1.0`
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
			r2Backend.readdir(packDirPath).catch(() => []),
		);
		const packNames = entries.filter((f) => f.endsWith(".pack"));
		if (packNames.length === 1) {
			const packData = await perfStep(
				"read consolidated pack (fast path)",
				() => r2Backend.readFile(`${packDirPath}/${packNames[0]}`),
			);
			return {
				status: 200,
				headers: {
					"Content-Type": "application/x-git-upload-pack-result",
					"Cache-Control": "no-cache",
				},
				body: Buffer.concat([
					pktLine("NAK\n"),
					Buffer.isBuffer(packData)
						? packData
						: Buffer.from(packData as string),
				]),
			};
		}
	}

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
		git.packObjects({ fs: r2Backend, gitdir, oids }),
	);

	return {
		status: 200,
		headers: {
			"Content-Type": "application/x-git-upload-pack-result",
			"Cache-Control": "no-cache",
		},
		body: Buffer.concat([
			pktLine("NAK\n"),
			Buffer.from(packfile ?? new Uint8Array()),
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
	// specific old packs are redundant (object-count safety check), so it's safe —
	// and necessary — to explicitly remove them from R2 here, now that the
	// replacement pack they're redundant with is confirmed uploaded. Skipping this
	// is what let every push leave one more permanent pack file in R2 forever.
	if (staleRepackedPaths.length > 0) {
		const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
		await bulkDeleteFromR2(
			staleRepackedPaths.map((p) => `${prefix}${p}`),
		).catch((err: unknown) => {
			console.error(
				`[git-http] failed to delete superseded packs from R2 (non-fatal):`,
				err,
			);
		});
		// The dir-listing cache for objects/pack/ was already invalidated once by
		// the sync above (before these deletes ran) — invalidate again so a
		// concurrent readdir can't have repopulated it with the now-stale names in
		// the gap between that invalidation and this delete.
		invalidateCache(`dir:${ownerKey}/${repoName}/`);
		for (const relativePath of staleRepackedPaths) {
			deleteCache(`${ownerKey}/${repoName}/${relativePath}`);
		}
	}

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
