/**
 * Isomorphic-git HTTP backend for upload-pack and receive-pack.
 * Replaces the native-git-binary approach in git-http-backend.ts.
 *
 * upload-pack (clone/fetch): reads directly from R2 via r2Backend, no local disk.
 * receive-pack (push): writes incoming pack to /tmp gitdir, then syncs to R2.
 */

import { spawn } from "node:child_process";
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

// Runs a real `git` subprocess (no shell — args passed as an array, `input`
// piped directly to stdin, never string-interpolated into a command line).
// Rejects with stderr attached if the process exits non-zero.
function runGit(
	args: string[],
	options: { cwd: string; input?: string },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd: options.cwd });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout);
			else
				reject(
					new Error(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`),
				);
		});
		if (options.input !== undefined) child.stdin.write(options.input);
		child.stdin.end();
	});
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
// Consolidation itself shells out to real `git rev-list`/`git pack-objects` rather
// than using isomorphic-git's own traversal + packObjects (as this used to). That
// wasn't a style choice: isomorphic-git's delta resolution doesn't reliably resolve
// a thin pack's deltas against base objects that live in a *different* pack from the
// one being indexed (only a repo's most-recently-received pack, or loose objects,
// resolve correctly) — every incoming push pack is thin by design (git's push
// protocol omits objects the server should already have), so once a repo has more
// than one pack, a later push's indexPack can silently produce an index with
// unresolvable delta references. That corrupted specific objects in a way that also
// broke this function's own former safety check (which relied on isomorphic-git's
// traversal completing) — permanently, since a broken pack doesn't heal itself.
// Real git's pack/delta handling resolves the exact same on-disk data correctly
// (verified via `git fsck`/`git rev-list --objects` against a repo isomorphic-git
// had already given up on) — same category of gap `withRepositoryWorktree` in
// git-repo-storage.ts already works around by shelling out to native git.
async function repackLocal(localGitdir: string): Promise<string[]> {
	try {
		if ((await countLocalPacks(localGitdir)) < REPACK_PACK_COUNT_THRESHOLD) {
			return [];
		}

		const refsOutput = await runGit(
			["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/tags"],
			{ cwd: localGitdir },
		);
		const tipOids = refsOutput
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (tipOids.length === 0) return [];

		// `git rev-list --objects` is the reachability walk; feeding its output to
		// `git pack-objects` is real git's own repack primitive, so both steps get
		// git's (not isomorphic-git's) delta/thin-pack handling. pack-objects exits
		// non-zero if it can't resolve something it was asked to include — a
		// stronger safety property than the traversal-completion flag this replaced,
		// since it's git's own pack layer refusing rather than an approximation of it.
		const revListOutput = await runGit(["rev-list", "--objects", ...tipOids], {
			cwd: localGitdir,
		});
		if (!revListOutput.trim()) return [];

		const packDir = path.join(localGitdir, "objects", "pack");
		const newBase = `pack-${Date.now()}`;
		// pack-objects appends "-<sha1-of-pack-contents>" to the given base name and
		// prints that sha1 (alone, on stdout) once the .pack/.idx pair is written.
		const packSha = (
			await runGit(["pack-objects", "--quiet", path.join(packDir, newBase)], {
				cwd: localGitdir,
				input: revListOutput,
			})
		).trim();
		if (!packSha) return [];

		const newPackFile = `${newBase}-${packSha}.pack`;
		const newIdxFile = `${newBase}-${packSha}.idx`;

		const allEntries: string[] = await Promise.resolve()
			.then(() => localFsPromises.readdir(packDir))
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
		console.error("[git-http] repack failed (non-fatal):", err);
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
			console.error(
				"[git-http] failed to delete superseded packs from R2 (non-fatal):",
				err,
			);
		},
	);
	// The dir-listing cache for objects/pack/ was already invalidated once by
	// syncRepositoryToR2 (before these deletes ran) — invalidate again so a
	// concurrent readdir can't have repopulated it with the now-stale names in
	// the gap between that invalidation and this delete.
	invalidateCache(`dir:${ownerKey}/${repoName}/`);
	for (const relativePath of staleRelativePaths) {
		deleteCache(`${ownerKey}/${repoName}/${relativePath}`);
	}
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
