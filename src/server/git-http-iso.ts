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
	const refs: Array<{ name: string; oid: string }> = [];

	let headOid: string | null = null;
	try {
		headOid = await git.resolveRef({ fs: r2Backend, gitdir, ref: "HEAD" });
	} catch {}

	let headSymref = `refs/heads/${defaultBranch}`;
	try {
		const cb = await git.currentBranch({
			fs: r2Backend,
			gitdir,
			fullname: true,
		});
		if (cb) headSymref = cb;
	} catch {}

	if (headOid) refs.push({ name: "HEAD", oid: headOid });

	const branches = await git.listBranches({ fs: r2Backend, gitdir });
	for (const branch of branches) {
		try {
			const oid = await git.resolveRef({
				fs: r2Backend,
				gitdir,
				ref: `refs/heads/${branch}`,
			});
			refs.push({ name: `refs/heads/${branch}`, oid });
		} catch {}
	}

	const tags = await git.listTags({ fs: r2Backend, gitdir });
	for (const tag of tags) {
		try {
			const oid = await git.resolveRef({
				fs: r2Backend,
				gitdir,
				ref: `refs/tags/${tag}`,
			});
			refs.push({ name: `refs/tags/${tag}`, oid });
		} catch {}
	}

	return { refs, headSymref };
}

// --- object graph traversal ---

async function collectReachableOids(
	gitdir: string,
	startOids: string[],
): Promise<string[]> {
	const seen = new Set<string>();
	const queue = [...startOids];

	while (queue.length > 0) {
		const oid = queue.pop() as string;
		if (seen.has(oid)) continue;
		seen.add(oid);

		try {
			const obj = await git.readObject({ fs: r2Backend, gitdir, oid });

			if (obj.type === "commit") {
				const { commit } = await git.readCommit({
					fs: r2Backend,
					gitdir,
					oid,
				});
				queue.push(commit.tree, ...commit.parent);
			} else if (obj.type === "tree") {
				const { tree } = await git.readTree({ fs: r2Backend, gitdir, oid });
				queue.push(...tree.map((e) => e.oid));
			} else if (obj.type === "tag") {
				const { tag } = await git.readTag({ fs: r2Backend, gitdir, oid });
				queue.push(tag.object);
			}
		} catch {}
	}

	return Array.from(seen);
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
	legacyOwnerKeys: string[] = [],
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
		legacyOwnerKeys,
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

	await syncRepositoryToR2(ownerKey, repoName, ownerDbId, legacyOwnerKeys);

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
