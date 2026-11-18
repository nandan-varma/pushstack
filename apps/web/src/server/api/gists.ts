/**
 * GitHub's gists at `/api/v3`: create, get (also at a revision), update and
 * delete one gist, and the four lists. A gist is readable by anyone holding
 * its id (secret means unlisted); writes need its owner and a `gist` token.
 */
import { GitInvalidRequestError, isNotFoundError } from "git-fs-s3";
import { MAX_GISTS_PER_USER } from "#/lib/limits";
import { getAccessForGist } from "../gist-access";
import {
	applyGistUpdate,
	createGistFiles,
	type GistFile,
	type GistFileInput,
	initGistRepo,
	readGistFileContent,
	readGistFiles,
} from "../gist-git";
import {
	countGistComments,
	countGistsForOwner,
	deleteGistRow,
	findGistById,
	type GistPage,
	type GistPageOptions,
	type GistRowWithOwner,
	generateGistId,
	gistCommentCounts,
	insertGist,
	listGistsForOwner,
	listPublicGists,
	listPublicGistsForUser,
	listStarredGists,
	updateGistRow,
} from "../gist-store";
import { deleteGistStorage } from "../git-fs";
import { withGistLock } from "../git-repo-lock";
import { logError } from "../perf-log";
import {
	type ApiContext,
	type Caller,
	callerIdentity,
	requireCaller,
	requireScope,
} from "./auth";
import {
	ApiError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	type PageParams,
	pageParams,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { gist, gistSimple } from "./serializers";

type GistListId =
	| "gists/list"
	| "gists/list-public"
	| "gists/list-starred"
	| "gists/list-for-user";

function pageOptions(ctx: ApiContext, id: GistListId): GistPageOptions {
	const query = queryParams(ctx, id, "Gist");
	const params = pageParams(ctx.url.searchParams);
	return {
		since: query.since ? new Date(query.since) : undefined,
		limit: params.perPage,
		offset: params.offset,
	};
}

export async function filesAt(
	id: string,
	revision = "HEAD",
): Promise<GistFile[]> {
	try {
		return await readGistFiles(id, revision);
	} catch (error) {
		if (isNotFoundError(error)) throw notFoundError();
		throw error;
	}
}

async function forkOf(row: GistRowWithOwner): Promise<{
	gist: GistRowWithOwner;
	files: GistFile[];
	comments: number;
} | null> {
	if (!row.forkOfId) return null;
	const parent = await findGistById(row.forkOfId);
	if (!parent) return null;
	const [files, comments] = await Promise.all([
		filesAt(parent.id),
		countGistComments(parent.id),
	]);
	return { gist: parent, files, comments };
}

export async function fullGist(row: GistRowWithOwner, revision = "HEAD") {
	const [files, comments, parent] = await Promise.all([
		filesAt(row.id, revision),
		countGistComments(row.id),
		forkOf(row),
	]);
	return gist(row, files, comments, revision, parent);
}

async function listResponse(
	ctx: ApiContext,
	id: GistListId,
	load: (options: GistPageOptions) => Promise<GistPage | null>,
) {
	const params = pageParams(ctx.url.searchParams);
	const data = await load(pageOptions(ctx, id));
	if (!data) throw notFoundError();
	return gistListResponse(ctx, data, params);
}

/** One page of gists, each with its comment count and files at `HEAD`. */
export async function gistListResponse(
	ctx: ApiContext,
	data: GistPage,
	params: PageParams,
) {
	const rows = params.reachable ? data.gists : [];
	const counts = await gistCommentCounts(rows.map((row) => row.id));
	const items = await Promise.all(
		rows.map(async (row) =>
			gistSimple(row, await filesAt(row.id), counts.get(row.id) ?? 0),
		),
	);
	return json(items, 200, linkHeader(ctx.url, params, data.total));
}

export async function listGists(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	return listResponse(ctx, "gists/list", (options) =>
		listGistsForOwner(userId, options),
	);
}

export async function listPublic(ctx: ApiContext) {
	return listResponse(ctx, "gists/list-public", listPublicGists);
}

export async function listStarred(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	return listResponse(ctx, "gists/list-starred", (options) =>
		listStarredGists(userId, options),
	);
}

export async function listForUser(ctx: ApiContext) {
	const { username } = pathParams(ctx, "gists/list-for-user");
	return listResponse(ctx, "gists/list-for-user", (options) =>
		listPublicGistsForUser(username, options),
	);
}

function gistWriteError(error: unknown): never {
	if (error instanceof GitInvalidRequestError) {
		throw new ApiError(422, error.message);
	}
	throw error;
}

export async function createGistHandler(ctx: ApiContext) {
	const caller = requireScope(ctx, "gist");
	const data = await requestBody(ctx, "gists/create", "Gist");
	if ((await countGistsForOwner(caller.userId)) >= MAX_GISTS_PER_USER) {
		throw new ApiError(422, "Maximum number of gists reached");
	}
	const id = generateGistId();
	const files: GistFileInput[] = Object.entries(data.files).map(
		([path, file]) => ({ path, content: file.content }),
	);
	const identity = await callerIdentity(caller);
	try {
		await initGistRepo(id);
		await createGistFiles(id, files, identity);
	} catch (error) {
		await deleteGistStorage(id).catch((cleanup: unknown) =>
			logError("gists", `Storage for ${id} was not removed`, cleanup),
		);
		gistWriteError(error);
	}
	let row: GistRowWithOwner;
	try {
		await insertGist({
			id,
			ownerId: caller.userId,
			description: data.description ?? null,
			visibility: data.public ? "public" : "secret",
		});
		const inserted = await findGistById(id);
		if (!inserted) throw new Error("Gist missing after insert");
		row = inserted;
	} catch (error) {
		await deleteGistStorage(id).catch((cleanup: unknown) =>
			logError("gists", `Storage for ${id} was not removed`, cleanup),
		);
		throw error;
	}
	const shaped = await fullGist(row);
	return json(shaped, 201, { Location: shaped.url });
}

async function gistByPath(
	ctx: ApiContext,
	id: "gists/get" | "gists/get-revision" | "gists/update" | "gists/delete",
): Promise<GistRowWithOwner> {
	const { gist_id } = pathParams(ctx, id);
	const row = await findGistById(gist_id);
	if (!row) throw notFoundError();
	return row;
}

export async function getGist(ctx: ApiContext) {
	return json(await fullGist(await gistByPath(ctx, "gists/get")));
}

export async function getGistRevision(ctx: ApiContext) {
	const { sha } = pathParams(ctx, "gists/get-revision");
	return json(await fullGist(await gistByPath(ctx, "gists/get-revision"), sha));
}

async function writableGist(
	ctx: ApiContext,
	id: "gists/update" | "gists/delete",
): Promise<{ row: GistRowWithOwner; caller: Caller }> {
	const caller = requireScope(ctx, "gist");
	const row = await gistByPath(ctx, id);
	if (!getAccessForGist(row, caller.userId).canWrite) throw notFoundError();
	return { row, caller };
}

export async function updateGistHandler(ctx: ApiContext) {
	const { row, caller } = await writableGist(ctx, "gists/update");
	const data = await requestBody(ctx, "gists/update", "Gist");
	const current = data.files
		? new Map((await filesAt(row.id)).map((file) => [file.path, file]))
		: new Map<string, GistFile>();
	const writes: GistFileInput[] = [];
	const deletes = new Set<string>();
	for (const [name, patch] of Object.entries(data.files ?? {})) {
		const existing = current.get(name);
		if (patch === null) {
			if (existing) deletes.add(name);
			continue;
		}
		const target = patch.filename ?? name;
		const renames = patch.filename !== undefined && target !== name;
		const content = patch.content;
		const hasContent = content !== undefined && content !== null;
		if (patch.filename === undefined && !hasContent) {
			if (existing) deletes.add(name);
			continue;
		}
		if (renames) {
			if (existing) deletes.add(name);
			if (hasContent) {
				writes.push({ path: target, content });
			} else if (existing) {
				writes.push({
					path: target,
					content: await readGistFileContent(row.id, name),
				});
			}
		} else if (hasContent) {
			writes.push({ path: name, content });
		}
	}
	const changed = writes.length > 0 || deletes.size > 0;
	if (changed) {
		try {
			await applyGistUpdate(
				row.id,
				{ files: writes, deletes: [...deletes] },
				await callerIdentity(caller),
			);
		} catch (error) {
			gistWriteError(error);
		}
	}
	const now = new Date();
	await updateGistRow(row.id, {
		...(data.description !== undefined && { description: data.description }),
		updatedAt: now,
		...(changed && { pushedAt: now }),
	});
	const updated = await findGistById(row.id);
	if (!updated) throw notFoundError();
	return json(await fullGist(updated));
}

export async function deleteGistHandler(ctx: ApiContext) {
	const { row } = await writableGist(ctx, "gists/delete");
	await withGistLock(row.id, async () => {
		await deleteGistRow(row.id);
		await deleteGistStorage(row.id).catch((error: unknown) =>
			logError(
				"gists",
				`Gist ${row.id} deleted, but its storage cleanup failed`,
				error,
			),
		);
	});
	return noContent();
}
