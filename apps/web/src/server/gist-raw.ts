/**
 * `GET /gist/{owner}/{id}/raw/{revision}/{...path}`: a gist file's exact bytes
 * at a revision, the URL REST's `raw_url` points at. A revision is a commit
 * sha or `HEAD`; without one the file is read at `HEAD`.
 */
import { GitInvalidRequestError, isNotFoundError } from "git-fs-s3";
import { readGistFileContent } from "./gist-git";
import { findGistAtOwnerPath } from "./gist-store";
import { logError } from "./perf-log";
import { cacheControl, rawBytesResponse } from "./raw";

const notFound = () => new Response("Not found", { status: 404 });

const isRevision = (segment: string) =>
	segment === "HEAD" || /^[0-9a-f]{40}$/i.test(segment);

export async function serveGistRawFile(request: Request): Promise<Response> {
	// A malformed percent-escape would otherwise surface as a 500; this route
	// promises 404 for anything it cannot serve (as serveRawFile does).
	let decoded: string[];
	try {
		decoded = new URL(request.url).pathname
			.split("/")
			.filter(Boolean)
			.map(decodeURIComponent);
	} catch {
		return notFound();
	}
	const [root, owner, id, raw, ...rest] = decoded;
	if (root !== "gist" || raw !== "raw" || !owner || !id || rest.length === 0) {
		return notFound();
	}
	const hasRevision = isRevision(rest[0] ?? "");
	const revision = hasRevision ? (rest[0] as string) : "HEAD";
	const path = (hasRevision ? rest.slice(1) : rest).join("/");
	if (!path) return notFound();
	try {
		const gist = await findGistAtOwnerPath(owner, id);
		if (!gist) return notFound();
		const bytes = await readGistFileContent(gist.id, path, revision);
		return rawBytesResponse(
			path,
			bytes,
			cacheControl(gist.visibility === "public", revision),
		);
	} catch (error) {
		if (isNotFoundError(error) || error instanceof GitInvalidRequestError) {
			return notFound();
		}
		logError("gists", `Raw ${owner}/${id}@${revision}:${path} failed`, error);
		return new Response("Internal error", { status: 500 });
	}
}
