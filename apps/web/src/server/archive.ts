/**
 * Source archives, GitHub's zipball and tarball:
 * `/{owner}/{repo}/archive/refs/heads/{branch}.zip`, `…/refs/tags/{tag}.tar.gz`,
 * `…/archive/{sha}.zip` (or a bare branch or tag name). The REST routes
 * `GET /repos/{o}/{r}/zipball/{ref}` and `/tarball/{ref}` answer `302` to these
 * URLs, as GitHub's answer `302` to codeload. They are served on this origin
 * and stream while the archive is built, so nothing larger than one file is
 * ever held in memory (a buffered Vercel response is capped at 4.5 MB). Every
 * entry sits under `{repo}-{ref}/`, with the commit sha as the zip comment or
 * tar `comment`, and the archive is bounded (`limits.ts`).
 */

import { isFullSha, isNotFoundError, isSafeRefName } from "git-fs-s3";
import { MAX_ARCHIVE_BYTES } from "#/lib/limits";
import {
	type ArchiveEntry,
	chunkStream,
	tarChunks,
	zipChunks,
} from "./archive-format";
import { resolveDownloader } from "./download-auth";
import {
	ArchiveLimitError,
	getCommit,
	planArchive,
	readArchiveBlob,
} from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import { logError } from "./perf-log";
import { cacheControl } from "./raw";
import { getAccessForRepository } from "./repo-access";
import { findRepositoryByName } from "./repository-lookup";

export type ArchiveFormat = "zip" | "tar.gz";

export interface ArchiveTarget {
	/** The spelling used in archive URLs: `refs/heads/x`, `refs/tags/x` or a sha. */
	spec: string;
	/** The name that follows `{repo}-` in the download name and top directory. */
	label: string;
	/** A full sha pins the archive to a commit forever. */
	pinned: boolean;
}

/** The suffix of `name.zip` / `name.tar.gz`, or null. */
export function splitArchiveSuffix(
	value: string,
): { name: string; format: ArchiveFormat } | null {
	const match = /^(.+)\.(zip|tar\.gz)$/.exec(value);
	if (!match) return null;
	return { name: match[1] as string, format: match[2] as ArchiveFormat };
}

/** GitHub names a tag's directory without a leading `v` before a digit. */
function labelFor(kind: "heads" | "tags" | "sha", name: string): string {
	if (kind === "sha") return name.toLowerCase();
	const base = kind === "tags" ? name.replace(/^v(?=\d)/, "") : name;
	return base.replaceAll("/", "-");
}

/**
 * What `spec` names in this repository: a full ref (`refs/heads/x`,
 * `refs/tags/x`), a bare branch or tag name (a branch wins, as everywhere), or
 * a full commit sha. Null when nothing matches.
 */
export async function resolveArchiveTarget(
	repo: { name: string; owner: { username: string } },
	spec: string,
): Promise<ArchiveTarget | null> {
	const ownerKey = ownerKeyOf(repo);
	const exists = async (rev: string) => {
		try {
			await getCommit(ownerKey, repo.name, rev);
			return true;
		} catch (error) {
			if (isNotFoundError(error)) return false;
			throw error;
		}
	};
	const branch = spec.startsWith("refs/heads/") ? spec.slice(11) : null;
	const tag = spec.startsWith("refs/tags/") ? spec.slice(10) : null;
	// Validated without the `refs/heads/` or `refs/tags/` qualifier, which
	// `isSafeRefName` (branch names and shas) rejects by design.
	if (!isSafeRefName(branch ?? tag ?? spec)) return null;
	if (branch !== null) {
		return branch && (await exists(spec))
			? { spec, label: labelFor("heads", branch), pinned: false }
			: null;
	}
	if (tag !== null) {
		return tag && (await exists(spec))
			? { spec, label: labelFor("tags", tag), pinned: false }
			: null;
	}
	if (await exists(`refs/heads/${spec}`)) {
		return {
			spec: `refs/heads/${spec}`,
			label: labelFor("heads", spec),
			pinned: false,
		};
	}
	if (await exists(`refs/tags/${spec}`)) {
		return {
			spec: `refs/tags/${spec}`,
			label: labelFor("tags", spec),
			pinned: false,
		};
	}
	if (isFullSha(spec) && (await exists(spec))) {
		return { spec, label: labelFor("sha", spec), pinned: true };
	}
	return null;
}

const notFound = () =>
	new Response("Not found", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});

/** Entries of the archive: the top directory, then the plan's nodes beneath it. */
async function* archiveEntries(
	ownerKey: string,
	repoName: string,
	top: string,
	nodes: Awaited<ReturnType<typeof planArchive>>["nodes"],
): AsyncGenerator<ArchiveEntry> {
	const budget = { remaining: MAX_ARCHIVE_BYTES };
	yield {
		path: top,
		kind: "dir",
		executable: false,
		read: async () => new Uint8Array(0),
	};
	for (const node of nodes) {
		yield {
			path: `${top}/${node.path}`,
			kind: node.kind,
			executable: node.executable,
			read: () => readArchiveBlob(ownerKey, repoName, node.oid, budget),
		};
	}
}

/**
 * Stream the archive for `spec` of `owner/name`. 404 for an unknown or
 * unreadable repository or ref (a private repository answers like a missing
 * one); a PAT in `Authorization` works as well as the session.
 */
export async function serveArchive(
	request: Request,
	owner: string,
	name: string,
	spec: string,
	format: ArchiveFormat,
	options: { legacy?: boolean } = {},
): Promise<Response> {
	try {
		const repository = await findRepositoryByName(owner, name);
		if (!repository) return notFound();
		const downloader = await resolveDownloader(request);
		if ("response" in downloader) return downloader.response;
		const { userId } = downloader;
		if (!(await getAccessForRepository(repository, userId)).canRead) {
			return notFound();
		}
		const target = await resolveArchiveTarget(repository, spec);
		if (!target) return notFound();
		const ownerKey = ownerKeyOf(repository);
		const plan = await planArchive(ownerKey, repository.name, target.spec);
		// `legacy` is codeload's `legacy.zip`, the REST redirect target: GitHub
		// names those `{owner}-{repo}-{short sha}`.
		const top = options.legacy
			? `${repository.owner.username}-${repository.name}-${plan.commitSha.slice(0, 7)}`
			: `${repository.name}-${target.label}`;
		const entries = archiveEntries(ownerKey, repository.name, top, plan.nodes);
		const meta = { commitSha: plan.commitSha, mtime: plan.mtime };
		const body =
			format === "zip"
				? chunkStream(zipChunks(entries, meta))
				: chunkStream(tarChunks(entries, meta)).pipeThrough(
						// A failure while building the tar errors this stream (and the
						// response) instead of an unhandled stream error.
						new CompressionStream("gzip") as unknown as ReadableWritablePair<
							Uint8Array,
							Uint8Array
						>,
					);
		return new Response(body, {
			headers: {
				"Content-Type":
					format === "zip" ? "application/zip" : "application/gzip",
				"Content-Disposition": `attachment; filename=${top.replace(/[^A-Za-z0-9._-]/g, "_")}.${format}`,
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": cacheControl(
					repository.visibility === "public",
					target.pinned ? plan.commitSha : target.spec,
				),
			},
		});
	} catch (error) {
		if (isNotFoundError(error)) return notFound();
		if ((error as { code?: string } | null)?.code === "UnsafeFilepathError") {
			return new Response("Repository contains unsafe file names", {
				status: 422,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		}
		if (error instanceof ArchiveLimitError) {
			return new Response(error.message, {
				status: 413,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}
		logError("archive", `GET ${owner}/${name} archive ${spec} failed`, error);
		return new Response("Internal error", { status: 500 });
	}
}
