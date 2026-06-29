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
import git from "isomorphic-git";
import type { GitAuthContext } from "./git-auth";
import { r2Backend } from "./git-r2-backend";
import {
	ensureRepositoryHydrated,
	syncRepositoryToR2,
} from "./git-repo-storage";
import { getRepoGitStorageRoot } from "./git-storage-naming";

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
		Promise.resolve(git.currentBranch({ fs: r2Backend, gitdir, fullname: true }))
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

// ponytail: filesystem param lets this run against R2 (clone) or local disk (repack after push)
async function collectReachableOids(
	gitdir: string,
	startOids: string[],
	filesystem: any = r2Backend,
): Promise<string[]> {
	const seen = new Set<string>();
	// ponytail: promise-per-oid deduplicates concurrent traversal paths
	const promises = new Map<string, Promise<void>>();

	function visit(oid: string): Promise<void> {
		if (promises.has(oid)) return promises.get(oid)!;

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
	return Array.from(seen);
}

// Pack index v2: magic(4) + version(4) + fanout(256×4); fanout[255] = total object count
function countPackIndexObjects(data: Buffer): number {
	if (data.length < 8 + 256 * 4) return -1;
	if (data.readUInt32BE(0) !== 0xff744f63) return -1;
	if (data.readUInt32BE(4) !== 2) return -1;
	return data.readUInt32BE(8 + 255 * 4);
}

// Consolidate all pack files into one after a push so R2 always has a single pack.
// This keeps clone-time object lookups O(1) pack searches instead of O(N pushes).
async function repackLocal(localGitdir: string): Promise<void> {
	try {
		// Null-coalesce to [] so a mock/stub returning undefined never crashes .map()
		const branches: string[] =
			(await Promise.resolve(git.listBranches({ fs, gitdir: localGitdir })).catch(() => null)) ?? [];
		const tags: string[] =
			(await Promise.resolve(git.listTags({ fs, gitdir: localGitdir })).catch(() => null)) ?? [];

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

		if (tipOids.length === 0) return;

		const allOids = await collectReachableOids(localGitdir, tipOids, fs);
		if (allOids.length === 0) return;

		const { packfile } = await git.packObjects({
			fs,
			gitdir: localGitdir,
			oids: allOids,
		});
		if (!packfile) return;

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

		// Guard against data loss: only delete old packs if the consolidated pack covers at least
		// as many objects as all old packs combined (catches incomplete traversal due to missing objects).
		const allEntries: string[] = await Promise.resolve()
			.then(() => localFsPromises.readdir(packDir))
			.catch(() => []);

		const oldIdxNames = allEntries.filter(
			(f) => f !== `${newName}.idx` && f.endsWith(".idx"),
		);
		const [newIdxBuf, ...oldIdxBufs] = await Promise.all([
			Promise.resolve()
				.then(() => localFsPromises.readFile(path.join(packDir, `${newName}.idx`)))
				.catch(() => null),
			...oldIdxNames.map((n) =>
				Promise.resolve()
					.then(() => localFsPromises.readFile(path.join(packDir, n)))
					.catch(() => null),
			),
		]);

		const newCount = newIdxBuf
			? countPackIndexObjects(Buffer.from(newIdxBuf))
			: -1;
		const oldTotal = oldIdxBufs.reduce((sum, buf) => {
			const n = buf ? countPackIndexObjects(Buffer.from(buf)) : 0;
			return sum + Math.max(0, n);
		}, 0);

		if (newCount < 0 || (oldTotal > 0 && newCount < oldTotal)) {
			// ponytail: skip deletion; old packs are the safety net when traversal was incomplete
			console.warn(
				`[git-http] repack: keeping old packs (new=${newCount} old=${oldTotal})`,
			);
			return;
		}

		await Promise.all(
			allEntries
				.filter((f) => f !== `${newName}.pack` && f !== `${newName}.idx`)
				.filter(
					(f) =>
						f.endsWith(".pack") || f.endsWith(".idx") || f.endsWith(".keep"),
				)
				.map((f) =>
					localFsPromises.unlink(path.join(packDir, f)).catch(() => {}),
				),
		);
	} catch (err) {
		// Repack failure is non-fatal — the push still succeeded, just with an extra pack file
		console.error("[git-http] repack failed (non-fatal):", err);
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
	if (service === "git-upload-pack" && !authContext.canRead) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: "Forbidden",
		};
	}
	if (service === "git-receive-pack" && !authContext.canWrite) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: "Forbidden",
		};
	}

	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	const { refs, headSymref } = await listAllRefs(gitdir, defaultBranch);

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
}

// --- upload-pack (clone/fetch) ---

export async function handleUploadPackIso(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
): Promise<GitHttpResult> {
	if (!authContext.canRead) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: "Forbidden",
		};
	}

	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	const body = Buffer.from(await request.arrayBuffer());
	const lines = parsePktLines(body);

	const wants: string[] = [];
	const haves: string[] = [];
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
	}

	if (wants.length === 0) {
		return {
			status: 200,
			headers: { "Content-Type": "application/x-git-upload-pack-result" },
			body: Buffer.concat([pktLine("NAK\n")]),
		};
	}

	// ponytail: fresh clone = no haves, so we need all objects. The consolidated pack
	// (written by repackLocal after every push) already contains exactly that — serve it
	// directly and skip the O(N-objects) traversal + repack entirely.
	if (haves.length === 0) {
		const packDirPath = `${gitdir}/objects/pack`;
		const entries = await r2Backend.readdir(packDirPath).catch(() => []);
		const packNames = entries.filter((f) => f.endsWith(".pack"));
		if (packNames.length === 1) {
			const packData = await r2Backend.readFile(`${packDirPath}/${packNames[0]}`);
			return {
				status: 200,
				headers: {
					"Content-Type": "application/x-git-upload-pack-result",
					"Cache-Control": "no-cache",
				},
				body: Buffer.concat([
					pktLine("NAK\n"),
					Buffer.isBuffer(packData) ? packData : Buffer.from(packData as string),
				]),
			};
		}
	}

	const wantOids = await collectReachableOids(gitdir, wants);
	let oids = wantOids;
	if (haves.length > 0) {
		const haveOids = new Set(await collectReachableOids(gitdir, haves));
		oids = wantOids.filter((oid) => !haveOids.has(oid));
	}

	const { packfile } = await git.packObjects({ fs: r2Backend, gitdir, oids });

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
	if (!authContext.canWrite) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: "Forbidden",
		};
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

	const localGitdir = await ensureRepositoryHydrated(
		ownerKey,
		repoName,
		null,
		defaultBranch,
	);

	// ensureRepositoryHydrated may return a path that was inited in R2 but not on local disk.
	// git.writeRef and indexPack need refs/heads/ and objects/ to exist locally.
	try {
		await localFsPromises.access(path.join(localGitdir, "HEAD"));
	} catch {
		await localFsPromises.mkdir(localGitdir, { recursive: true });
		await git.init({ fs, dir: localGitdir, defaultBranch, bare: true });
	}

	// Write incoming PACK into objects/pack/ so indexPack can process it there
	if (packData.length >= 4) {
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
	}

	// Update refs
	const ZERO_OID = "0".repeat(40);
	for (const { newOid, refName } of refUpdates) {
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
	}

	await repackLocal(localGitdir);
	await syncRepositoryToR2(ownerKey, repoName, ownerDbId);

	const responseBody = Buffer.concat([
		pktLine("unpack ok\n"),
		...refUpdates.map(({ refName }) => pktLine(`ok ${refName}\n`)),
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
