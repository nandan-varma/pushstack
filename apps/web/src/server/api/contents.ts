import type { TreeEntry } from "git-fs-s3/ops";
import {
	getBlobByOid,
	getBlobSize,
	getBlobSizes,
	getPathEntry,
	getSubmoduleUrls,
	getTreeByOid,
} from "../git-read";
import { safeCommitRevSchema, safeRepoPathSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { ApiContext } from "./auth";
import { apiCaps } from "./caps";
import { apiUrl, encodePath, htmlUrl, json, notFoundError } from "./http";
import { readableRepository } from "./repo-lookup";
import { fullNameOf } from "./threads";

/** Base64 wrapped at 60 characters per line, as GitHub encodes `content`. */
function wrappedBase64(bytes: Uint8Array): string {
	const encoded = Buffer.from(bytes).toString("base64");
	return encoded.replace(/.{1,60}/g, "$&\n");
}

const kindOf = (entry: TreeEntry) =>
	entry.type === "tree"
		? "dir"
		: entry.type === "commit"
			? "submodule"
			: entry.mode === "120000"
				? "symlink"
				: "file";

interface Location {
	fullName: string;
	ref: string;
}

function baseShape(
	entry: TreeEntry,
	size: number,
	{ fullName, ref }: Location,
) {
	const path = encodePath(entry.path);
	const query = `?ref=${encodeURIComponent(ref)}`;
	const kind = kindOf(entry);
	const url = apiUrl(`/repos/${fullName}/contents/${path}${query}`);
	const gitUrl =
		kind === "dir"
			? apiUrl(`/repos/${fullName}/git/trees/${entry.oid}`)
			: kind === "submodule"
				? null
				: apiUrl(`/repos/${fullName}/git/blobs/${entry.oid}`);
	const htmlPath =
		kind === "dir"
			? `/repo/${fullName}/tree/${encodePath(ref)}/${path}`
			: `/repo/${fullName}/blob/${encodePath(ref)}/${path}`;
	const html = kind === "submodule" ? null : htmlUrl(htmlPath);
	return {
		type: kind,
		size,
		name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
		path: entry.path,
		sha: entry.oid,
		url,
		git_url: gitUrl,
		html_url: html,
		download_url:
			kind === "file" || kind === "symlink"
				? htmlUrl(`/api/raw/${fullName}/${encodePath(ref)}/${path}`)
				: null,
		_links: { self: url, git: gitUrl, html },
	};
}

export async function getContents(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const path = (ctx.params.path ?? "").replace(/\/+$/, "");
	const ref = ctx.url.searchParams.get("ref") || repo.defaultBranch;
	if (
		!safeRepoPathSchema.safeParse(path).success ||
		!safeCommitRevSchema.safeParse(ref).success
	) {
		throw notFoundError();
	}
	const ownerKey = ownerKeyOf(repo);
	const location = { fullName: fullNameOf(repo), ref };
	const { entry, commitOid } = await getPathEntry(
		ownerKey,
		repo.name,
		ref,
		path,
	);
	if (!entry) throw notFoundError();

	if (entry.type === "tree") {
		const { entries } = await getTreeByOid(ownerKey, repo.name, entry.oid, {
			limit: apiCaps.directoryEntries,
		});
		const listed = entries.map((child) => ({
			...child,
			path: path ? `${path}/${child.path}` : child.path,
		}));
		const sizes = await getBlobSizes(
			ownerKey,
			repo.name,
			listed.filter((child) => child.type === "blob").map((child) => child.oid),
			apiCaps.sizeReadConcurrency,
		);
		return json(
			listed.map((child) =>
				baseShape(child, sizes.get(child.oid) ?? 0, location),
			),
		);
	}

	if (entry.type === "commit") {
		const urls = await getSubmoduleUrls(ownerKey, repo.name, commitOid);
		return json({
			...baseShape(entry, 0, location),
			submodule_git_url: urls.get(path) ?? null,
		});
	}

	const size = await getBlobSize(ownerKey, repo.name, entry.oid);
	if (entry.mode === "120000") {
		const target =
			size <= apiCaps.symlinkTargetBytes
				? new TextDecoder().decode(
						await getBlobByOid(ownerKey, repo.name, entry.oid),
					)
				: null;
		return json({ ...baseShape(entry, size, location), target });
	}
	if (size > apiCaps.contentsInlineBytes) {
		return json({
			...baseShape(entry, size, location),
			content: "",
			encoding: "none",
		});
	}
	const bytes = await getBlobByOid(ownerKey, repo.name, entry.oid);
	return json({
		...baseShape(entry, size, location),
		content: wrappedBase64(bytes),
		encoding: "base64",
	});
}
