/**
 * Git HTTP Backend using native git services
 * Handles git smart HTTP protocol for clone, fetch, and push operations
 */

import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import type { GitAuthContext } from "./git-auth";
import { GitInvalidRequestError } from "./git-errors";
import {
	ensureRepositoryHydrated,
	initRepositoryStorage,
	syncRepositoryToR2,
} from "./git-repo-storage";

type GitHttpResult = {
	status: number;
	headers: Record<string, string>;
	body: BodyInit;
};

const DEFAULT_MAX_GIT_REQUEST_BYTES = 50 * 1024 * 1024;

export function getMaxGitRequestBytes(): number {
	const configuredLimit = Number.parseInt(
		process.env.GIT_HTTP_MAX_BODY_BYTES || "",
		10,
	);

	return Number.isFinite(configuredLimit) && configuredLimit > 0
		? configuredLimit
		: DEFAULT_MAX_GIT_REQUEST_BYTES;
}

async function pipeRequestToStdin(
	request: Request,
	stdin: Writable,
	maxBytes: number,
): Promise<void> {
	const reader = request.body?.getReader();

	if (!reader) {
		stdin.end();
		return;
	}

	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				throw new GitInvalidRequestError(
					`Git request body exceeds ${maxBytes} bytes`,
				);
			}

			await new Promise<void>((resolve, reject) => {
				stdin.write(Buffer.from(value), (error) => {
					if (error) {
						reject(error);
						return;
					}

					resolve();
				});
			});
		}

		stdin.end();
	} catch (error) {
		stdin.destroy(error instanceof Error ? error : undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

function createGitResponseStream(
	git: ReturnType<typeof spawn>,
	service: "upload-pack" | "receive-pack",
	onSuccess?: () => Promise<void>,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const errorChunks: Buffer[] = [];

			if (!git.stdout || !git.stderr) {
				controller.error(new Error("Failed to spawn git process"));
				return;
			}

			git.stdout.on("data", (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk));
			});

			git.stderr.on("data", (chunk: Buffer) => {
				errorChunks.push(chunk);
			});

			git.on("error", (error) => {
				controller.error(error);
			});

			git.on("close", async (code) => {
				if (code !== 0) {
					const errorMessage = Buffer.concat(errorChunks).toString();
					controller.error(
						new Error(
							errorMessage ||
								`Git ${service} exited with code ${code ?? "unknown"}`,
						),
					);
					return;
				}

				try {
					await onSuccess?.();
					controller.close();
				} catch (error) {
					controller.error(error);
				}
			});
		},
		cancel() {
			git.kill();
		},
	});
}

/**
 * Handle git-upload-pack (clone/fetch) using git command
 */
export async function handleUploadPack(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
	legacyOwnerKeys: string[] = [],
): Promise<GitHttpResult> {
	if (!authContext.canRead) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: Buffer.from("Forbidden: No read access"),
		};
	}

	const repoPath = await ensureRepositoryHydrated(
		ownerKey,
		repoName,
		legacyOwnerKeys,
		remoteUpdatedAt,
		defaultBranch,
	);
	return executeCgiService("upload-pack", repoPath, request);
}

/**
 * Handle git-receive-pack (push) using git command
 */
export async function handleReceivePack(
	ownerKey: string,
	repoName: string,
	request: Request,
	authContext: GitAuthContext,
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
	ownerDbId?: string,
	legacyOwnerKeys: string[] = [],
): Promise<GitHttpResult> {
	if (!authContext.canWrite) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: Buffer.from("Forbidden: No write access"),
		};
	}

	const repoPath = await ensureRepositoryHydrated(
		ownerKey,
		repoName,
		legacyOwnerKeys,
		remoteUpdatedAt,
		defaultBranch,
	);
	return executeCgiService("receive-pack", repoPath, request, async () => {
		await syncRepositoryToR2(ownerKey, repoName, ownerDbId, legacyOwnerKeys);
	});
}

/**
 * Execute git service as CGI
 */
async function executeCgiService(
	service: "upload-pack" | "receive-pack",
	repoPath: string,
	request: Request,
	onSuccess?: () => Promise<void>,
): Promise<GitHttpResult> {
	const git = spawn("git", [service, "--stateless-rpc", repoPath]);
	const maxBytes = getMaxGitRequestBytes();

	try {
		await pipeRequestToStdin(request, git.stdin, maxBytes);
	} catch (error) {
		git.kill();
		throw error;
	}

	return {
		status: 200,
		headers: {
			"Content-Type": `application/x-git-${service}-result`,
			"Cache-Control": "no-cache",
		},
		body: createGitResponseStream(git, service, onSuccess),
	};
}

/**
 * Generate git info/refs response
 */
export async function handleInfoRefs(
	ownerKey: string,
	repoName: string,
	service: "git-upload-pack" | "git-receive-pack",
	authContext: GitAuthContext,
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
	legacyOwnerKeys: string[] = [],
): Promise<GitHttpResult> {
	// Check permissions
	if (service === "git-upload-pack" && !authContext.canRead) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: Buffer.from("Forbidden: No read access"),
		};
	}

	if (service === "git-receive-pack" && !authContext.canWrite) {
		return {
			status: 403,
			headers: { "Content-Type": "text/plain" },
			body: Buffer.from("Forbidden: No write access"),
		};
	}

	const repoPath = await ensureRepositoryHydrated(
		ownerKey,
		repoName,
		legacyOwnerKeys,
		remoteUpdatedAt,
		defaultBranch,
	);

	return new Promise((resolve) => {
		const git = spawn("git", [
			service.replace("git-", ""),
			"--stateless-rpc",
			"--advertise-refs",
			repoPath,
		]);

		const chunks: Buffer[] = [];
		const errorChunks: Buffer[] = [];

		git.stdout.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		git.stderr.on("data", (chunk: Buffer) => {
			errorChunks.push(chunk);
		});

		git.on("close", (code) => {
			if (code !== 0) {
				const errorMsg = Buffer.concat(errorChunks).toString();
				console.error(`Git ${service} --advertise-refs failed:`, errorMsg);
				resolve({
					status: 500,
					headers: { "Content-Type": "text/plain" },
					body: Buffer.from("Repository not found or inaccessible"),
				});
				return;
			}

			const refs = Buffer.concat(chunks);

			// Format as git smart HTTP protocol response
			const serviceHeader = `# service=${service}\n`;
			const headerLength = (serviceHeader.length + 4)
				.toString(16)
				.padStart(4, "0");
			const header = Buffer.from(`${headerLength}${serviceHeader}0000`);
			const body = Buffer.concat([header, refs]);

			resolve({
				status: 200,
				headers: {
					"Content-Type": `application/x-${service}-advertisement`,
					"Cache-Control": "no-cache",
				},
				body,
			});
		});

		git.on("error", (err) => {
			console.error(`Failed to spawn git ${service}:`, err);
			resolve({
				status: 500,
				headers: { "Content-Type": "text/plain" },
				body: Buffer.from(`Failed to execute git: ${err.message}`),
			});
		});

		git.stdin.end();
	});
}

/**
 * Initialize a bare repository on disk
 */
export async function initBareRepository(
	ownerKey: string,
	repoName: string,
	defaultBranch: string = "main",
): Promise<void> {
	await initRepositoryStorage(ownerKey, repoName, defaultBranch);
}
