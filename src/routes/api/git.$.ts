import { createFileRoute } from "@tanstack/react-router";

/**
 * Git HTTP Protocol Catch-All Route
 * Handles all git smart HTTP protocol requests:
 * - GET /api/git/{owner}/{repo}.git/info/refs?service=git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-receive-pack
 *
 * Uses the isomorphic-git HTTP backend (git-http-iso.ts) which reads/writes
 * directly to/from Cloudflare R2. No native git binary dependency.
 */

import { parseGitUrl } from "#/lib/git-url-parser";
import { authenticateGitRequest } from "#/server/git-auth";
import { formatErrorResponse } from "#/server/git-errors";
import {
	handleInfoRefsIso,
	handleReceivePackIso,
	handleUploadPackIso,
} from "#/server/git-http-iso";
import { getRepoStorageCoordinates } from "#/server/git-storage-naming";
import { findRepositoryByName } from "#/server/repositories";

export const Route = createFileRoute("/api/git/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				try {
					const url = request.url;
					const parsed = parseGitUrl(url);

					if (!parsed || !parsed.isInfoRefs || !parsed.service) {
						return new Response("Invalid git request", { status: 400 });
					}

					const { owner, repo, service } = parsed;

					const repository = await findRepositoryByName(owner, repo);
					if (!repository) {
						return new Response("Repository not found", { status: 404 });
					}

					const authContext = await authenticateGitRequest(
						request,
						owner,
						repo,
						service === "git-receive-pack",
						repository,
					);

					const storage = getRepoStorageCoordinates(repository);

					const result = await handleInfoRefsIso(
						storage.ownerKey,
						repo,
						service,
						authContext,
						repository.defaultBranch || "main",
					);

					return new Response(result.body, {
						status: result.status,
						headers: result.headers,
					});
				} catch (error) {
					const errorResponse = formatErrorResponse(error);
					if (errorResponse.status >= 500) {
						console.error("[git GET]", error);
					}
					return new Response(JSON.stringify(errorResponse.body), {
						status: errorResponse.status,
						headers: {
							"Content-Type": "application/json",
							...errorResponse.headers,
						},
					});
				}
			},

			POST: async ({ request }) => {
				try {
					const contentLength = Number.parseInt(
						request.headers.get("content-length") || "",
						10,
					);
					const maxRequestBytes =
						Number.parseInt(process.env.GIT_HTTP_MAX_BODY_BYTES || "", 10) ||
						50 * 1024 * 1024;

					if (
						Number.isFinite(contentLength) &&
						contentLength > maxRequestBytes
					) {
						return new Response("Git request body too large", { status: 413 });
					}

					const url = request.url;
					const parsed = parseGitUrl(url);

					if (!parsed || !parsed.service || parsed.isInfoRefs) {
						return new Response("Invalid git request", { status: 400 });
					}

					const { owner, repo, service } = parsed;

					const repository = await findRepositoryByName(owner, repo);
					if (!repository) {
						return new Response("Repository not found", { status: 404 });
					}

					const authContext = await authenticateGitRequest(
						request,
						owner,
						repo,
						service === "git-receive-pack",
						repository,
					);

					const storage = getRepoStorageCoordinates(repository);

					let result: {
						status: number;
						headers: Record<string, string>;
						body: BodyInit;
					};
					if (service === "git-upload-pack") {
						result = await handleUploadPackIso(
							storage.ownerKey,
							repo,
							request,
							authContext,
						);
					} else if (service === "git-receive-pack") {
						result = await handleReceivePackIso(
							storage.ownerKey,
							repo,
							request,
							authContext,
							repository.defaultBranch || "main",
							repository.ownerId,
						);
					} else {
						return new Response("Invalid service", { status: 400 });
					}

					return new Response(result.body, {
						status: result.status,
						headers: result.headers,
					});
				} catch (error) {
					const errorResponse = formatErrorResponse(error);
					if (errorResponse.status >= 500) {
						console.error("[git POST]", error);
					}
					return new Response(JSON.stringify(errorResponse.body), {
						status: errorResponse.status,
						headers: {
							"Content-Type": "application/json",
							...errorResponse.headers,
						},
					});
				}
			},
		},
	},
});
