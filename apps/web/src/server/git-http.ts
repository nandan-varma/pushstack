/**
 * The git smart-HTTP endpoint (`/api/git/{owner}/{repo}[.git]/…`) over
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
import { recordPushReferences } from "./commit-references";
import { GIT_HTTP_MAX_BODY_BYTES } from "./config";
import { authorizeGitRequest } from "./git-auth";
import { detectLooseObjectsHint, prefetchAllPacks } from "./git-fs";
import { afterRepositoryPush, httpHooks as hooks, repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { ownerKeyOf } from "./git-storage-naming";
import { logError, logWarn, perfContext } from "./perf-log";
import {
	authFailuresExhausted,
	hitRateLimit,
	identityFor,
	type RateStatus,
	rateLimitExceededMessage,
	rateLimitHeaders,
	recordAuthFailure,
} from "./rate-limit";
import { findRepositoryByName } from "./repository-lookup";

type GitService = "git-upload-pack" | "git-receive-pack";

export interface GitRoute {
	owner: string;
	repo: string;
	service: GitService;
	/** `GET …/info/refs?service=…` (the ref advertisement) vs `POST …/<service>`. */
	isInfoRefs: boolean;
}

const GIT_ROUTE_PREFIX = "/api/git/";
// Same shape as usernames and repository names: never "." or "..".
const NAME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVICES = new Set<string>(["git-upload-pack", "git-receive-pack"]);
const isService = (value: string | null): value is GitService =>
	value !== null && SERVICES.has(value);

/** Parse `/api/git/{owner}/{repo}[.git]/(info/refs?service=…|<service>)`, or null. */
export function parseGitUrl(url: string): GitRoute | null {
	const { pathname, searchParams } = new URL(url);
	if (!pathname.startsWith(GIT_ROUTE_PREFIX)) return null;
	const [owner, repoSegment, ...rest] = pathname
		.slice(GIT_ROUTE_PREFIX.length)
		.split("/")
		.filter(Boolean);
	const repo = repoSegment?.replace(/\.git$/, "");
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
			? { owner, repo, service, isInfoRefs: true }
			: null;
	}
	return isService(path)
		? { owner, repo, service: path, isInfoRefs: false }
		: null;
}

/**
 * The request body, capped while streaming: a chunked request declares no
 * Content-Length, and upload-pack is reachable anonymously on public
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
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
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
	repoName: string,
	repoId: number,
	defaultBranch: string,
	pusherId: string | null,
	body: Uint8Array,
) {
	const parsed = parseReceivePackBody(body);
	const outcome = await withRepositoryLock(ownerKey, repoName, async () => {
		const result = await applyReceivePack(
			repoFor(ownerKey, repoName),
			parsed,
			{ defaultBranch, repack: { threshold: REPACK_PACK_COUNT_THRESHOLD } },
			hooks,
		);
		afterRepositoryPush(ownerKey, repoName);
		// Best effort: a failure here must not fail an already-applied push.
		if (pusherId && !result.unpackError) {
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
		}
		return result;
	});
	return receivePackResponse(outcome.results, {
		capabilities: parsed.capabilities,
		unpackError: outcome.unpackError,
	});
}

/** Over the limit: a plain 403 that git prints. */
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
	const needsWrite = route.service === "git-receive-pack";
	const hasCredentials = request.headers.has("authorization");
	if (hasCredentials) {
		const exhausted = await authFailuresExhausted(request);
		if (exhausted) return rateLimited(exhausted);
	}
	let auth: Awaited<ReturnType<typeof authorizeGitRequest>>;
	try {
		auth = await authorizeGitRequest(request, repository, needsWrite);
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
	if (route.isInfoRefs) {
		return handleInfoRefs(
			repoFor(ownerKey, repoName),
			{
				service: route.service,
				defaultBranch: repository.defaultBranch,
				agent: "pushstack/1.0",
			},
			hooks,
		);
	}
	const body = await readGitRequestBody(request);
	if (needsWrite) {
		return receivePack(
			ownerKey,
			repoName,
			repository.id,
			repository.defaultBranch,
			auth.userId,
			body,
		);
	}
	return handleUploadPack(
		repoFor(ownerKey, repoName),
		body,
		{
			// Skip doomed loose-object probes on packed repos, and warm every
			// pack in parallel before the (sequential) reachability walk.
			beforeWalk: async () => {
				await Promise.all([
					detectLooseObjectsHint(ownerKey, repoName),
					prefetchAllPacks(ownerKey, repoName),
				]);
			},
		},
		hooks,
	);
}

/** Serve one request to the git endpoint; never throws. */
export async function serveGitRequest(request: Request): Promise<Response> {
	const route = parseGitUrl(request.url);
	if (!route) return new Response("Invalid git request", { status: 400 });
	const meter: { rate: RateStatus | null } = { rate: null };
	try {
		const result = await perfContext(
			`git ${route.service}${route.isInfoRefs ? " info/refs" : ""} ${route.owner}/${route.repo}`,
			() => serve(request, route, meter),
		);
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
