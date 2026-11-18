/**
 * The git smart-HTTP endpoint (`/{owner}/{repo}[.git]/…`, GitHub's clone URL) over
 * git-fs-s3's `/http` handlers: URL routing, auth, the body cap, the write
 * lock around pushes, and post-push bookkeeping. Every service runs straight
 * against R2 through `gitFs`: upload-pack (clone/fetch) reads lock-free;
 * receive-pack (push) writes the pack and its index, CAS-updates refs and
 * repacks under the repo lock — objects always land before a ref names them,
 * and a repack removes superseded packs only after the consolidated one is
 * indexed.
 */
import {
	formatErrorResponse,
	GitAuthenticationError,
	GitError,
	GitInvalidRequestError,
	GitRepositoryNotFoundError,
} from "git-fs-s3";
import {
	applyReceivePack,
	handleInfoRefs,
	handleUploadPack,
	parseReceivePackBody,
	REPACK_PACK_COUNT_THRESHOLD,
	receivePackResponse,
} from "git-fs-s3/http";
import type { Repository } from "#/db/app-schema";
import { vetPush } from "./branch-protection";
import { recordPushReferences } from "./commit-references";
import { GIT_HTTP_MAX_BODY_BYTES } from "./config";
import { GIST_BRANCH, gistOpsHooks, gistRepoFor } from "./gist-git";
import {
	authorizeGitRequest,
	authorizeWikiGitRequest,
	type GitAccess,
} from "./git-auth";
import {
	detectLooseObjectsHint,
	gistStorageExists,
	prefetchAllPacks,
	prefetchGistPacks,
} from "./git-fs";
import { afterRepositoryPush, httpHooks as hooks, repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { GIST_ID_RE, ownerKeyOf, type RepoKind } from "./git-storage-naming";
import { logError, logWarn, perfContext } from "./perf-log";
import { recordHeadBranchDeleted } from "./pull-request-store";
import {
	authFailuresExhausted,
	hitRateLimit,
	identityFor,
	type RateStatus,
	rateLimitExceededMessage,
	rateLimitHeaders,
	recordAuthFailure,
} from "./rate-limit";
import { draftReleasesForDeletedTag } from "./release-store";
import { findRepositoryByName } from "./repository-lookup";
import { ensureWikiRepository, WIKI_BRANCH } from "./wiki-git";

type GitService = "git-upload-pack" | "git-receive-pack";

export interface GitRoute {
	owner: string;
	repo: string;
	service: GitService;
	/** `GET …/info/refs?service=…` (the ref advertisement) vs `POST …/<service>`. */
	isInfoRefs: boolean;
	/** `/{owner}/{repo}.wiki[.git]`: the wiki's own repository. */
	wiki: boolean;
}

const NAME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVICES = new Set<string>(["git-upload-pack", "git-receive-pack"]);
const isService = (value: string | null): value is GitService =>
	value !== null && SERVICES.has(value);

/**
 * Parse `/{owner}/{repo}[.wiki][.git]/(info/refs?service=…|<service>)`, or
 * null. `{repo}.wiki.git` and `{repo}.wiki` are the wiki's clone URLs; a
 * repository name never ends in `.wiki`, so the two are never ambiguous.
 */
export function parseGitUrl(url: string): GitRoute | null {
	const { pathname, searchParams } = new URL(url);
	const [owner, repoSegment, ...rest] = pathname.split("/").filter(Boolean);
	const withoutGit = repoSegment?.replace(/\.git$/, "");
	const wiki = !!withoutGit?.endsWith(".wiki");
	const repo = wiki ? withoutGit.slice(0, -".wiki".length) : withoutGit;
	if (
		!owner ||
		!repo ||
		!NAME_SEGMENT.test(owner) ||
		!NAME_SEGMENT.test(repo)
	) {
		return null;
	}
	const path = rest.join("/");
	if (path === "info/refs") {
		const service = searchParams.get("service");
		return isService(service)
			? { owner, repo, service, isInfoRefs: true, wiki }
			: null;
	}
	return isService(path)
		? { owner, repo, service: path, isInfoRefs: false, wiki }
		: null;
}

/**
 * The decoded request body, with encoded and decoded bytes capped while
 * streaming. Native Git gzip-compresses larger upload-pack requests.
 * A chunked request declares no Content-Length, and upload-pack is reachable anonymously on public
 * repositories, so an unbounded read would let anyone exhaust memory.
 */
export async function readGitRequestBody(
	request: Request,
	maxBytes = GIT_HTTP_MAX_BODY_BYTES,
): Promise<Uint8Array> {
	const tooLarge = () =>
		new GitError(`Git request body exceeds ${maxBytes} bytes`, 413);
	const declared = Number(request.headers.get("content-length") ?? Number.NaN);
	if (declared > maxBytes) throw tooLarge();
	if (!request.body) return new Uint8Array();
	const encoding = request.headers
		.get("content-encoding")
		?.trim()
		.toLowerCase();
	if (encoding && encoding !== "identity" && encoding !== "gzip") {
		throw new GitError("Unsupported git request content encoding", 415);
	}
	let encodedBytes = 0;
	const bounded = request.body.pipeThrough(
		new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
			transform(chunk, controller) {
				encodedBytes += chunk.byteLength;
				if (encodedBytes > maxBytes) throw tooLarge();
				controller.enqueue(chunk);
			},
		}),
	);
	const decoded =
		encoding === "gzip"
			? bounded.pipeThrough(new DecompressionStream("gzip"))
			: bounded;
	const reader = decoded.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read().catch((error: unknown) => {
			if (error instanceof GitError || encoding !== "gzip") throw error;
			throw new GitInvalidRequestError("Invalid gzip git request body");
		});
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			throw tooLarge();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

async function receivePack(
	ownerKey: string,
	repository: Repository,
	auth: GitAccess,
	defaultBranch: string,
	body: Uint8Array,
	kind: RepoKind = "repo",
) {
	const repoName = repository.name;
	const repoId = repository.id;
	const pusherId = auth.userId;
	const parsed = parseReceivePackBody(body);
	const outcome = await withRepositoryLock(ownerKey, repoName, async () => {
		const result = await applyReceivePack(
			repoFor(ownerKey, repoName, kind),
			parsed,
			{
				defaultBranch,
				repack: { threshold: REPACK_PACK_COUNT_THRESHOLD },
				// A wiki has no branch protection rules, as on GitHub.
				vetRefUpdates:
					kind === "repo"
						? (updates, repo) => vetPush(repository, pusherId, updates, repo)
						: undefined,
			},
			hooks,
		);
		afterRepositoryPush(ownerKey, repoName, kind);
		// A wiki has no issues, pull requests or releases, so a wiki push runs
		// none of the repository's post-push bookkeeping.
		if (
			kind === "repo" &&
			pusherId &&
			!result.unpackError &&
			result.results.some((r) => r.ok)
		) {
			try {
				await recordPushReferences({
					ownerKey,
					repoName,
					repoId,
					defaultBranch,
					actorId: pusherId,
					updates: parsed.refUpdates,
					results: result.results,
				});
			} catch (error) {
				logWarn("git-http", "recording commit references failed", error);
			}
			try {
				await draftReleasesOfDeletedTags(
					repoId,
					parsed.refUpdates,
					result.results,
				);
			} catch (error) {
				logWarn("git-http", "drafting releases of deleted tags failed", error);
			}
			try {
				await recordDeletedHeads(
					repoId,
					pusherId,
					parsed.refUpdates,
					result.results,
				);
			} catch (error) {
				logWarn("git-http", "recording deleted branches failed", error);
			}
		}
		return result;
	});
	return receivePackResponse(outcome.results, {
		capabilities: parsed.capabilities,
		unpackError: outcome.unpackError,
		messages: outcome.messages,
	});
}

/** Branches a push deleted: their pull requests get `head_ref_deleted`, open ones close. */
async function recordDeletedHeads(
	repoId: number,
	actorId: string,
	updates: ReturnType<typeof parseReceivePackBody>["refUpdates"],
	results: Awaited<ReturnType<typeof applyReceivePack>>["results"],
): Promise<void> {
	const accepted = new Set(results.filter((r) => r.ok).map((r) => r.refName));
	for (const update of updates) {
		if (
			accepted.has(update.refName) &&
			update.refName.startsWith("refs/heads/") &&
			/^0{40}$/.test(update.newOid)
		) {
			await recordHeadBranchDeleted(
				repoId,
				update.refName.slice("refs/heads/".length),
				actorId,
			);
		}
	}
}

/** Tags a push deleted: their releases stay, as drafts (GitHub's behavior). */
async function draftReleasesOfDeletedTags(
	repoId: number,
	updates: ReturnType<typeof parseReceivePackBody>["refUpdates"],
	results: Awaited<ReturnType<typeof applyReceivePack>>["results"],
): Promise<void> {
	const accepted = new Set(results.filter((r) => r.ok).map((r) => r.refName));
	for (const update of updates) {
		if (
			accepted.has(update.refName) &&
			update.refName.startsWith("refs/tags/") &&
			/^0{40}$/.test(update.newOid)
		) {
			await draftReleasesForDeletedTag(
				repoId,
				update.refName.slice("refs/tags/".length),
			);
		}
	}
}

function rateLimited(rate: RateStatus) {
	return {
		status: 403,
		body: `${rateLimitExceededMessage(rate)}\n`,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			...rateLimitHeaders(rate),
		},
	};
}

async function serve(
	request: Request,
	route: GitRoute,
	meter: { rate: RateStatus | null },
) {
	if ((request.method === "GET") !== route.isInfoRefs) {
		throw new GitInvalidRequestError("Invalid git request");
	}
	const repository = await findRepositoryByName(route.owner, route.repo);
	if (!repository) throw new GitRepositoryNotFoundError("Repository not found");
	// A disabled wiki is indistinguishable from a missing repository, byte for
	// byte: its bytes stay, they are simply not served.
	if (route.wiki && !repository.hasWiki) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}
	const needsWrite = route.service === "git-receive-pack";
	const hasCredentials = request.headers.has("authorization");
	if (hasCredentials) {
		const exhausted = await authFailuresExhausted(request);
		if (exhausted) return rateLimited(exhausted);
	}
	let auth: Awaited<ReturnType<typeof authorizeGitRequest>>;
	try {
		auth = await (route.wiki
			? authorizeWikiGitRequest(request, repository, needsWrite)
			: authorizeGitRequest(request, repository, needsWrite));
	} catch (error) {
		// Bad credentials count against the IP (token guessing).
		if (hasCredentials && error instanceof GitAuthenticationError) {
			await recordAuthFailure(request);
		}
		throw error;
	}

	// Metered by user when authenticated (so users behind one NAT don't share
	// a bucket), else by client IP. Over the limit: a plain 403 git prints.
	const rate = await hitRateLimit(
		needsWrite ? "git-write" : "git",
		identityFor(request, auth.userId),
	);
	meter.rate = rate;
	if (rate?.exceeded) return rateLimited(rate);

	const ownerKey = ownerKeyOf(repository);
	const repoName = repository.name;
	const kind: RepoKind = route.wiki ? "wiki" : "repo";
	const defaultBranch = route.wiki ? WIKI_BRANCH : repository.defaultBranch;
	if (route.isInfoRefs) {
		// Cloning a wiki that has never been written is an empty repository,
		// so its HEAD exists before the first page.
		if (route.wiki) await ensureWikiRepository(ownerKey, repoName);
		return handleInfoRefs(
			repoFor(ownerKey, repoName, kind),
			{ service: route.service, defaultBranch, agent: "pushstack/1.0" },
			hooks,
		);
	}
	const body = await readGitRequestBody(request);
	if (needsWrite) {
		return receivePack(ownerKey, repository, auth, defaultBranch, body, kind);
	}
	return handleUploadPack(
		repoFor(ownerKey, repoName, kind),
		body,
		{
			// Skip doomed loose-object probes on packed repos, and warm every
			// pack in parallel before the (sequential) reachability walk.
			beforeWalk: async () => {
				await Promise.all([
					detectLooseObjectsHint(ownerKey, repoName, kind),
					prefetchAllPacks(ownerKey, repoName, kind),
				]);
			},
		},
		hooks,
	);
}

export interface GistGitRoute {
	gistId: string;
	service: GitService;
	/** `GET …/info/refs?service=…` (the ref advertisement) vs `POST …/<service>`. */
	isInfoRefs: boolean;
}

/**
 * Parse `/{id}.git/(info/refs?service=…|<service>)`, or null. A gist's clone
 * URL is one path segment, which no TanStack route can express (a param cannot
 * share a segment with a literal suffix), so the entry point matches it before
 * the router.
 */
export function parseGistGitUrl(url: string): GistGitRoute | null {
	let pathname: string;
	let searchParams: URLSearchParams;
	try {
		({ pathname, searchParams } = new URL(url));
	} catch {
		return null;
	}
	const [segment, ...rest] = pathname.split("/").filter(Boolean);
	const gistId = segment?.endsWith(".git")
		? segment.slice(0, -".git".length)
		: "";
	if (!GIST_ID_RE.test(gistId)) return null;
	const path = rest.join("/");
	if (path === "info/refs") {
		const service = searchParams.get("service");
		return isService(service) ? { gistId, service, isInfoRefs: true } : null;
	}
	return isService(path) ? { gistId, service: path, isInfoRefs: false } : null;
}

interface GitServeResult {
	status: number;
	body: string | Uint8Array<ArrayBuffer>;
	headers: Record<string, string>;
}

/** Run one git request, adding the rate-limit headers and the error response shape. */
async function gitResponse(
	request: Request,
	label: string,
	run: (meter: { rate: RateStatus | null }) => Promise<GitServeResult>,
): Promise<Response> {
	const meter: { rate: RateStatus | null } = { rate: null };
	try {
		const result = await perfContext(label, () => run(meter));
		return new Response(result.body, {
			status: result.status,
			headers: {
				...result.headers,
				...(meter.rate && rateLimitHeaders(meter.rate)),
			},
		});
	} catch (error) {
		const { status, body, headers } = formatErrorResponse(error);
		if (status >= 500) logError("git-http", `${request.method} failed`, error);
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json", ...headers },
		});
	}
}

async function serveGist(
	request: Request,
	route: GistGitRoute,
	meter: { rate: RateStatus | null },
): Promise<GitServeResult> {
	if ((request.method === "GET") !== route.isInfoRefs) {
		throw new GitInvalidRequestError("Invalid git request");
	}
	if (route.service === "git-receive-pack") {
		// Every supported write path is REST (`gh gist edit`) or the web UI.
		// GitHub accepts pushes to a gist; this difference is documented.
		return {
			status: 403,
			body: "Gists are read-only over git. Edit the gist through the API.\n",
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		};
	}
	if (!(await gistStorageExists(route.gistId))) {
		throw new GitRepositoryNotFoundError("Gist not found");
	}
	const rate = await hitRateLimit("git", identityFor(request, null));
	meter.rate = rate;
	if (rate?.exceeded) return rateLimited(rate);
	if (route.isInfoRefs) {
		return handleInfoRefs(
			gistRepoFor(route.gistId),
			{
				service: route.service,
				defaultBranch: GIST_BRANCH,
				agent: "pushstack/1.0",
			},
			hooks,
		);
	}
	return handleUploadPack(
		gistRepoFor(route.gistId),
		await readGitRequestBody(request),
		{ beforeWalk: () => prefetchGistPacks(route.gistId) },
		gistOpsHooks(route.gistId),
	);
}

export function serveGitRequest(request: Request): Promise<Response> {
	const route = parseGitUrl(request.url);
	if (!route) {
		return Promise.resolve(
			new Response("Invalid git request", { status: 400 }),
		);
	}
	return gitResponse(
		request,
		`git ${route.service}${route.isInfoRefs ? " info/refs" : ""} ${route.owner}/${route.repo}`,
		(meter) => serve(request, route, meter),
	);
}

export function serveGistGitRequest(request: Request): Promise<Response> {
	const route = parseGistGitUrl(request.url);
	if (!route) {
		return Promise.resolve(
			new Response("Invalid git request", { status: 400 }),
		);
	}
	return gitResponse(
		request,
		`git ${route.service}${route.isInfoRefs ? " info/refs" : ""} gist ${route.gistId}`,
		(meter) => serveGist(request, route, meter),
	);
}
