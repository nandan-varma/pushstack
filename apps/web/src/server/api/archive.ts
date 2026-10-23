import { type ArchiveFormat, resolveArchiveTarget } from "../archive";
import type { ApiContext } from "./auth";
import { encodePath, htmlUrl, notFoundError } from "./http";
import { pathParams } from "./input";
import { readableRepository } from "./repo-lookup";

/**
 * `GET /repos/{owner}/{repo}/zipball/{ref}` and `/tarball/{ref}`: a `302` to
 * the streamed archive on this origin (src/server/archive.ts), as GitHub
 * redirects to codeload. `ref` is a branch, tag or full commit sha.
 */
async function redirectToArchive(
	ctx: ApiContext,
	ref: string,
	format: ArchiveFormat,
): Promise<Response> {
	const { repo } = await readableRepository(ctx);
	const target = await resolveArchiveTarget(repo, ref);
	if (!target) throw notFoundError();
	const location = htmlUrl(
		`/${repo.owner.username}/${repo.name}/archive/${encodePath(target.spec)}.${format}`,
	);
	return new Response(null, { status: 302, headers: { Location: location } });
}

export const downloadZipball = (ctx: ApiContext) =>
	redirectToArchive(
		ctx,
		pathParams(ctx, "repos/download-zipball-archive").ref,
		"zip",
	);

export const downloadTarball = (ctx: ApiContext) =>
	redirectToArchive(
		ctx,
		pathParams(ctx, "repos/download-tarball-archive").ref,
		"tar.gz",
	);
