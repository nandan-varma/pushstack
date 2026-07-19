import { createFileRoute } from "@tanstack/react-router";

/**
 * Raw file content endpoint: GET /api/raw/{owner}/{repo}/{branchOrSha}/{...path}
 *
 * Serves the exact bytes of a file at a given ref, for "Raw" links and
 * permalinks from the file viewer. Runs on the same origin as the app (no
 * isolated raw-content subdomain like GitHub's raw.githubusercontent.com),
 * so text content is always forced to `text/plain` (never the file's real
 * mime type — an .html/.svg file served as its real content-type here would
 * let arbitrary repo content execute script under this app's origin/cookies).
 */

import { getMimeType } from "#/lib/language-detection";
import { getFileContent } from "#/server/git-history-ops";
import { isSafeRefName, isSafeRepoPath } from "#/server/git-ref-name";
import { getRepoStorageCoordinates } from "#/server/git-storage-naming";
import { getAccessForRepository } from "#/server/repo-access";
import { findRepositoryByName } from "#/server/repositories";
import { getCurrentUserOptional } from "#/server/session";

const SAFE_INLINE_MIME_PREFIXES = ["image/", "video/", "audio/"];

function safeContentType(filePath: string, isBinary: boolean): string {
	if (!isBinary) return "text/plain; charset=utf-8";

	const mime = getMimeType(filePath);
	// SVG is XML that can carry <script> — never trust it enough to render inline.
	if (mime === "image/svg+xml") return "text/plain; charset=utf-8";
	if (
		mime === "application/pdf" ||
		SAFE_INLINE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
	) {
		return mime;
	}
	return "application/octet-stream";
}

export const Route = createFileRoute("/api/raw/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				try {
					const { pathname } = new URL(request.url);
					const segments = pathname
						.replace(/^\/api\/raw\//, "")
						.split("/")
						.filter(Boolean)
						.map((segment) => decodeURIComponent(segment));
					const [owner, name, ref, ...pathParts] = segments;
					const path = pathParts.join("/");
					if (!owner || !name || !ref || !path) {
						return new Response("Not found", { status: 404 });
					}
					// This route builds ref/path straight from URL segments rather than
					// going through files.ts's zod-validated server functions — validate
					// them the same way those do (safeRefNameSchema/safeRepoPathSchema)
					// before either reaches getFileContent, which resolves `ref` via
					// isomorphic-git's git.resolveRef. That primitive doesn't validate
					// ref format internally (see git-ref-name.ts's comment), so an
					// unvalidated "../"-laden ref here would be a cross-repo path
					// traversal in a local-disk-configured deployment, same class as the
					// branch-name traversal fixed elsewhere in the app.
					if (!isSafeRefName(ref) || !isSafeRepoPath(path)) {
						return new Response("Not found", { status: 404 });
					}

					const repository = await findRepositoryByName(owner, name);
					if (!repository) {
						return new Response("Not found", { status: 404 });
					}

					const currentUser = await getCurrentUserOptional();
					const access = await getAccessForRepository(
						repository,
						currentUser?.id,
					);
					if (!access.canRead) {
						return new Response("Not found", { status: 404 });
					}

					const storage = getRepoStorageCoordinates(repository);
					const buffer = await getFileContent(
						storage.ownerKey,
						repository.name,
						path,
						ref,
					);
					const isBinary = buffer.includes(0);

					// `ref` is either a branch name (content can move under the same
					// URL, so this response must be revalidated quickly) or a full
					// 40-hex commit SHA (content-addressed — same bytes forever at
					// this URL, same reasoning as query-options.ts's
					// IMMUTABLE_STALE_TIME for SHA-pinned queries). Only cache
					// publicly/long when both that *and* the repo's visibility make
					// the response identical for every viewer regardless of auth —
					// a private repo's bytes must never end up in a shared/CDN cache.
					const isImmutableRef = /^[0-9a-f]{40}$/i.test(ref);
					const cacheControl =
						isImmutableRef && repository.visibility === "public"
							? "public, max-age=31536000, immutable"
							: "private, max-age=60";

					return new Response(Buffer.concat([buffer]), {
						headers: {
							"Content-Type": safeContentType(path, isBinary),
							"X-Content-Type-Options": "nosniff",
							"Content-Disposition": "inline",
							"Cache-Control": cacheControl,
						},
					});
				} catch {
					return new Response("Not found", { status: 404 });
				}
			},
		},
	},
});
