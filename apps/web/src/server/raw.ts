/**
 * `GET /{owner}/{repo}/raw/{ref}/{...path}` (GitHub's raw URL) — a file's exact bytes at a
 * branch or commit, for "Raw" links, downloads and media previews. Served on
 * the app's own origin, so only inert content types are used: text is always
 * `text/plain` (an .html or .svg served as itself would run script with this
 * origin's cookies).
 */
import { isNotFoundError, isSafeRefName, isSafeRepoPath } from "git-fs-s3";
import { getMimeType } from "#/lib/language-detection";
import { getRawFileContent } from "./git-read";
import { logError } from "./perf-log";
import { getAccessForRepository } from "./repo-access";
import { findRepositoryByName } from "./repository-lookup";
import { getCurrentUserOptional } from "./session";

const INLINE_MEDIA_PREFIXES = ["image/", "video/", "audio/"];
/** Chunked: a non-streamed function response is capped at 4.5 MB on Vercel. */
const CHUNK_BYTES = 256 * 1024;

function contentType(path: string, isBinary: boolean): string {
	if (!isBinary) return "text/plain; charset=utf-8";
	const mime = getMimeType(path);
	if (mime === "image/svg+xml") return "text/plain; charset=utf-8";
	if (
		mime === "application/pdf" ||
		INLINE_MEDIA_PREFIXES.some((p) => mime.startsWith(p))
	) {
		return mime;
	}
	return "application/octet-stream";
}

/**
 * Commit-pinned bytes never change; a branch's do. Only public repositories
 * may land in a shared (CDN) cache.
 */
function cacheControl(isPublic: boolean, ref: string): string {
	if (!isPublic) return "private, max-age=60";
	return /^[0-9a-f]{40}$/i.test(ref)
		? "public, max-age=31536000, immutable"
		: "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
}

const notFound = () => new Response("Not found", { status: 404 });

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
			offset += CHUNK_BYTES;
		},
	});
}

export async function serveRawFile(request: Request): Promise<Response> {
	// A malformed percent-escape (`%`, `%E0%A4%A`) makes `decodeURIComponent`
	// throw `URIError`, and the route handler has no catch, so it would surface
	// as a 500 and Sentry noise for a trivially crafted URL. This route promises
	// 404 for anything it cannot serve, and api/index.ts returns 404 here too.
	let decoded: string[];
	try {
		decoded = new URL(request.url).pathname
			.split("/")
			.filter(Boolean)
			.map(decodeURIComponent);
	} catch {
		return notFound();
	}
	const [owner, name, raw, ref, ...rest] = decoded;
	if (raw !== "raw") return notFound();
	const path = rest.join("/");
	// Validated here because these come straight off the URL: an unvalidated
	// ref or path could traverse into another repository's storage.
	if (
		!owner ||
		!name ||
		!ref ||
		!path ||
		!isSafeRefName(ref) ||
		!isSafeRepoPath(path)
	) {
		return notFound();
	}
	try {
		const [repository, currentUser] = await Promise.all([
			findRepositoryByName(owner, name),
			getCurrentUserOptional(),
		]);
		if (!repository) return notFound();
		if (!(await getAccessForRepository(repository, currentUser?.id)).canRead) {
			return notFound();
		}
		const file = await getRawFileContent(
			repository.owner.username,
			repository.name,
			ref,
			path,
		);
		if (file.kind === "too-large") {
			// Streaming from memory is what this endpoint does, so above the cap
			// the honest answer is to clone the repository instead.
			return new Response(
				`File is larger than this endpoint serves (${file.size} bytes). Use git clone.`,
				{
					status: 413,
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"X-Content-Type-Options": "nosniff",
					},
				},
			);
		}
		const bytes = file.bytes;
		return new Response(stream(bytes), {
			headers: {
				"Content-Length": String(bytes.byteLength),
				"Content-Type": contentType(path, bytes.includes(0)),
				"X-Content-Type-Options": "nosniff",
				"Content-Disposition": "inline",
				"Cache-Control": cacheControl(repository.visibility === "public", ref),
			},
		});
	} catch (error) {
		if (isNotFoundError(error)) return notFound();
		logError("raw", `GET ${owner}/${name}@${ref}:${path} failed`, error);
		return new Response("Internal error", { status: 500 });
	}
}
