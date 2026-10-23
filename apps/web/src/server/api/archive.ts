import { type ArchiveFormat, resolveArchiveTarget } from "../archive";
import type { ApiContext } from "./auth";
import { encodePath, htmlUrl, notFoundError } from "./http";
import { pathParams } from "./input";
import { readableRepository } from "./repo-lookup";

/**
 * `GET /repos/{owner}/{repo}/zipball/{ref}` and `/tarball/{ref}`: a `302` to
 * the streamed archive on this origin (src/server/archive.ts), as GitHub
 * redirects to codeload's `legacy.zip`/`legacy.tar.gz`. `ref` is a branch, tag
 * or full commit sha; without one, the default branch.
 */
async function redirectToArchive(
	ctx: ApiContext,
	ref: string,
	format: ArchiveFormat,
): Promise<Response> {
	const { repo } = await readableRepository(ctx);
	const target = await resolveArchiveTarget(repo, ref || repo.defaultBranch);
	if (!target) throw notFoundError();
	const location = htmlUrl(
		`/${repo.owner.username}/${repo.name}/legacy.${format}/${encodePath(target.spec)}`,
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
