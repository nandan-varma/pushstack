/**
 * GitHub's plain-text diff and patch URLs on the web origin:
 * `/{owner}/{repo}/commit/{sha}.diff|.patch`,
 * `/{owner}/{repo}/compare/{spec}.diff|.patch` and
 * `/{owner}/{repo}/pull/{n}.diff|.patch` (also under `pulls/`). The bodies are
 * the REST API's `diff`/`patch` media types (`api/patches.ts`). Unreadable
 * repositories are 404, as on GitHub. Bodies are bounded and streamed.
 */
import { isNotFoundError } from "git-fs-s3";
import { parseCompareSpec } from "#/lib/compare-spec";
import { formatPatches, unifiedDiff } from "./api/patches";
import { compareRevisions } from "./compare";
import { getCommit, getCommitDiff } from "./git-read";
import { safeCommitRevSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { logError } from "./perf-log";
import { getAccessForRepository } from "./repo-access";
import {
	findRepositoryByName,
	type RepositoryRowWithOwner,
} from "./repository-lookup";
import { getCurrentUserOptional } from "./session";
import { findPullRequestByNumber } from "./thread-store";

export type PatchFormat = "diff" | "patch";

/** Above this the body is refused rather than built in memory. */
export const MAX_WEB_PATCH_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

const TEXT_HEADERS = {
	"Content-Type": "text/plain; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
};

const notFound = () =>
	new Response("Not Found", { status: 404, headers: TEXT_HEADERS });

function textResponse(body: string, repo: RepositoryRowWithOwner): Response {
	const bytes = new TextEncoder().encode(body);
	if (bytes.byteLength > MAX_WEB_PATCH_BYTES) {
		return new Response(
			"This diff is too large to render here. Clone the repository and use git diff instead.\n",
			{ status: 406, headers: TEXT_HEADERS },
		);
	}
	let offset = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
			offset += CHUNK_BYTES;
		},
	});
	return new Response(stream, {
		headers: {
			...TEXT_HEADERS,
			"Content-Length": String(bytes.byteLength),
			"Cache-Control":
				repo.visibility === "public"
					? "public, max-age=60"
					: "private, no-cache",
		},
	});
}

async function readableRepo(
	owner: string,
	name: string,
): Promise<RepositoryRowWithOwner | null> {
	const [repo, user] = await Promise.all([
		findRepositoryByName(owner, name),
		getCurrentUserOptional(),
	]);
	if (!repo) return null;
	return (await getAccessForRepository(repo, user?.id)).canRead ? repo : null;
}

async function commitPatches(
	ownerKey: string,
	repoName: string,
	shas: string[],
) {
	return Promise.all(
		shas.map(async (sha) => ({
			info: await getCommit(ownerKey, repoName, sha),
			diff: await getCommitDiff(ownerKey, repoName, sha),
		})),
	);
}

async function render(
	label: string,
	owner: string,
	name: string,
	build: (repo: RepositoryRowWithOwner) => Promise<string | null>,
): Promise<Response> {
	try {
		const repo = await readableRepo(owner, name);
		if (!repo) return notFound();
		const body = await build(repo);
		return body === null ? notFound() : textResponse(body, repo);
	} catch (error) {
		if (isNotFoundError(error)) return notFound();
		logError("web-patches", `${label} ${owner}/${name} failed`, error);
		return new Response("Internal error", {
			status: 500,
			headers: TEXT_HEADERS,
		});
	}
}

/** `/{owner}/{repo}/commit/{rev}.diff|.patch`. */
export function serveCommitPatch(
	owner: string,
	name: string,
	rev: string,
	format: PatchFormat,
): Promise<Response> {
	return render(`commit ${rev}.${format}`, owner, name, async (repo) => {
		if (!safeCommitRevSchema.safeParse(rev).success) return null;
		const ownerKey = ownerKeyOf(repo);
		const info = await getCommit(ownerKey, repo.name, rev);
		const diff = await getCommitDiff(ownerKey, repo.name, info.oid);
		return format === "diff"
			? unifiedDiff(diff)
			: formatPatches([{ info, diff }]);
	});
}

/** `/{owner}/{repo}/compare/{spec}.diff|.patch`. */
export function serveComparePatch(
	owner: string,
	name: string,
	spec: string,
	format: PatchFormat,
): Promise<Response> {
	return render(`compare ${spec}.${format}`, owner, name, async (repo) => {
		const parsed = parseCompareSpec(spec, repo.owner.username);
		if (!parsed) return null;
		const base = parsed.base ?? repo.defaultBranch;
		if (
			!safeCommitRevSchema.safeParse(base).success ||
			!safeCommitRevSchema.safeParse(parsed.head).success
		) {
			return null;
		}
		const ownerKey = ownerKeyOf(repo);
		const comparison = await compareRevisions(
			ownerKey,
			repo.name,
			base,
			parsed.head,
		);
		if (format === "diff") return unifiedDiff(comparison.diff);
		return formatPatches(
			await commitPatches(
				ownerKey,
				repo.name,
				comparison.commits.map((commit) => commit.sha),
			),
		);
	});
}

/**
 * `/{owner}/{repo}/pull/{n}.diff|.patch`. A merged pull request is pinned to
 * the tips recorded when it merged, like its Files tab.
 */
export function servePullPatch(
	owner: string,
	name: string,
	number: string,
	format: PatchFormat,
): Promise<Response> {
	return render(`pull ${number}.${format}`, owner, name, async (repo) => {
		if (!/^[1-9][0-9]{0,9}$/.test(number)) return null;
		const pr = await findPullRequestByNumber(repo.id, Number(number));
		if (!pr) return null;
		const merged = pr.status === "merged" && pr.baseSha && pr.headSha;
		const base = merged ? (pr.baseSha as string) : pr.targetBranch;
		const head = merged ? (pr.headSha as string) : pr.sourceBranch;
		const ownerKey = ownerKeyOf(repo);
		const comparison = await compareRevisions(ownerKey, repo.name, base, head);
		if (format === "diff") return unifiedDiff(comparison.diff);
		return formatPatches(
			await commitPatches(
				ownerKey,
				repo.name,
				comparison.commits.map((commit) => commit.sha),
			),
		);
	});
}
