import { createFileRoute } from "@tanstack/react-router";

/**
 * Git HTTP Protocol Catch-All Route
 * Handles all git smart HTTP protocol requests:
 * - GET /api/git/{owner}/{repo}.git/info/refs?service=git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-receive-pack
 */

import { parseGitUrl } from "#/lib/git-url-parser";
import { isR2Configured } from "#/lib/r2";
import { authenticateGitRequest } from "#/server/git-auth";
import { formatErrorResponse } from "#/server/git-errors";
import {
	getMaxGitRequestBytes,
	handleInfoRefs,
	handleReceivePack,
	handleUploadPack,
} from "#/server/git-http-backend";
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

					// Get repository from database
					const repository = await findRepositoryByName(owner, repo);
					if (!repository) {
						return new Response("Repository not found", { status: 404 });
					}

					// Authenticate the request (throws GitAuthenticationError/GitAuthorizationError on failure)
					const authContext = await authenticateGitRequest(
						request,
						owner,
						repo,
						service === "git-receive-pack",
					);

					const storage = getRepoStorageCoordinates(repository);

					// Handle info/refs request
					const result = isR2Configured()
						? await handleInfoRefsIso(
								storage.ownerKey,
								repo,
								service,
								authContext,
								repository.defaultBranch || "main",
							)
						: await handleInfoRefs(
								storage.ownerKey,
								repo,
								service,
								authContext,
								repository.updatedAt,
								repository.defaultBranch || "main",
								storage.legacyOwnerKeys,
							);

					return new Response(result.body, {
						status: result.status,
						headers: result.headers,
					});
				} catch (error) {
					console.error("[git GET]", error);
					const errorResponse = formatErrorResponse(error);
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
					const maxRequestBytes = getMaxGitRequestBytes();

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

					// Get repository from database
					const repository = await findRepositoryByName(owner, repo);
					if (!repository) {
						return new Response("Repository not found", { status: 404 });
					}

					// Authenticate the request (throws GitAuthenticationError/GitAuthorizationError on failure)
					const authContext = await authenticateGitRequest(
						request,
						owner,
						repo,
						service === "git-receive-pack",
					);

					const storage = getRepoStorageCoordinates(repository);

					// Handle upload-pack (clone/fetch) or receive-pack (push)
					let result: {
						status: number;
						headers: Record<string, string>;
						body: BodyInit;
					};
					if (service === "git-upload-pack") {
						result = isR2Configured()
							? await handleUploadPackIso(
									storage.ownerKey,
									repo,
									request,
									authContext,
								)
							: await handleUploadPack(
									storage.ownerKey,
									repo,
									request,
									authContext,
									repository.updatedAt,
									repository.defaultBranch || "main",
									storage.legacyOwnerKeys,
								);
					} else if (service === "git-receive-pack") {
						result = isR2Configured()
							? await handleReceivePackIso(
									storage.ownerKey,
									repo,
									request,
									authContext,
									repository.defaultBranch || "main",
									storage.legacyOwnerKeys,
									repository.ownerId,
								)
							: await handleReceivePack(
									storage.ownerKey,
									repo,
									request,
									authContext,
									repository.updatedAt,
									repository.defaultBranch || "main",
									repository.ownerId,
									storage.legacyOwnerKeys,
								);
					} else {
						return new Response("Invalid service", { status: 400 });
					}

					return new Response(result.body, {
						status: result.status,
						headers: result.headers,
					});
				} catch (error) {
					console.error("[git POST]", error);
					const errorResponse = formatErrorResponse(error);
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
