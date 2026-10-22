/**
 * GitHub's plain-text diff and patch URLs on the web origin:
 * `/{owner}/{repo}/commit/{sha}.diff|.patch`,
 * `/{owner}/{repo}/compare/{spec}.diff|.patch` and
 * `/{owner}/{repo}/pull/{n}.diff|.patch` (also under `pulls/`). The bodies are
 * the REST API's `diff`/`patch` media types (`api/patches.ts`). Unreadable
 * repositories are 404, as on GitHub.
 *
 * Bodies are bounded while they're built: sections are encoded and counted
 * one at a time (per file, per commit), commits are diffed one after another,
 * and the response becomes a 406 as soon as the count passes the cap — so a
 * huge comparison never sits in memory whole.
 */
import { isNotFoundError } from "git-fs-s3";
import {
	type CommitInfo,
	DiffLimitError,
	type DiffResult,
} from "git-fs-s3/ops";
import { parseCompareSpec } from "#/lib/compare-spec";
import { formatPatchSections, unifiedDiffSections } from "./api/patches";
import { compareRevisions } from "./compare";
import { getCommit, getCommitDiff } from "./git-read";
import { safeCommitRevSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { logError, perfContext, perfStep } from "./perf-log";
import { getAccessForRepository } from "./repo-access";
import {
	findRepositoryByName,
	type RepositoryRowWithOwner,
} from "./repository-lookup";
import { getCurrentUserOptional } from "./session";
import { findPullRequestByNumber } from "./thread-store";

export type PatchFormat = "diff" | "patch";

/** Mutable so tests can lower it. */
export const webPatchCaps = {
	/** Above this many bytes the body is refused (406) rather than finished. */
	maxBytes: 10 * 1024 * 1024,
};

const CHUNK_BYTES = 256 * 1024;

const TEXT_HEADERS = {
	"Content-Type": "text/plain; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
};

const notFound = () =>
	new Response("Not Found", { status: 404, headers: TEXT_HEADERS });

class TooLargeError extends Error {}

/** Encoded sections and their running size; throws once past the cap. */
class BoundedBody {
	readonly parts: Uint8Array[] = [];
	size = 0;
	private readonly encoder = new TextEncoder();

	add(sections: Iterable<string>): void {
		for (const section of sections) {
			const bytes = this.encoder.encode(section);
			this.size += bytes.byteLength;
			if (this.size > webPatchCaps.maxBytes) throw new TooLargeError();
			this.parts.push(bytes);
		}
	}
}

function textResponse(body: BoundedBody, repo: RepositoryRowWithOwner) {
	const parts = body.parts;
	let index = 0;
	let offset = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			const part = parts[index];
			if (!part) return controller.close();
			controller.enqueue(part.subarray(offset, offset + CHUNK_BYTES));
			offset += CHUNK_BYTES;
			if (offset >= part.byteLength) {
				index += 1;
				offset = 0;
			}
		},
	});
	return new Response(stream, {
		headers: {
			...TEXT_HEADERS,
			"Content-Length": String(body.size),
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

/** Each commit's patch, diffed one at a time, oldest first. */
async function addPatches(
	body: BoundedBody,
	ownerKey: string,
	repoName: string,
	commits: CommitInfo[],
): Promise<void> {
	for (const [index, info] of commits.entries()) {
		const diff = await getCommitDiff(ownerKey, repoName, info.oid);
		body.add(formatPatchSections(info, diff, index, commits.length));
	}
}

function addDiff(body: BoundedBody, diff: DiffResult): void {
	body.add(unifiedDiffSections(diff));
}

async function render(
	label: string,
	owner: string,
	name: string,
	build: (repo: RepositoryRowWithOwner, body: BoundedBody) => Promise<boolean>,
): Promise<Response> {
	return perfContext(`web ${label} ${owner}/${name}`, async () => {
		try {
			const repo = await perfStep("readableRepo", () =>
				readableRepo(owner, name),
			);
			if (!repo) return notFound();
			const body = new BoundedBody();
			const found = await perfStep("build", () => build(repo, body));
			return found ? textResponse(body, repo) : notFound();
		} catch (error) {
			if (error instanceof TooLargeError || error instanceof DiffLimitError) {
				return new Response(
					"This diff is too large to render here. Clone the repository and use git diff instead.\n",
					{ status: 406, headers: TEXT_HEADERS },
				);
			}
			if (isNotFoundError(error)) return notFound();
			logError("web-patches", `${label} ${owner}/${name} failed`, error);
			return new Response("Internal error", {
				status: 500,
				headers: TEXT_HEADERS,
			});
		}
	});
}

/** `/{owner}/{repo}/commit/{rev}.diff|.patch`. */
export function serveCommitPatch(
	owner: string,
	name: string,
	rev: string,
	format: PatchFormat,
): Promise<Response> {
	return render(`commit ${rev}.${format}`, owner, name, async (repo, body) => {
		if (!safeCommitRevSchema.safeParse(rev).success) return false;
		const ownerKey = ownerKeyOf(repo);
		const info = await getCommit(ownerKey, repo.name, rev);
		const diff = await getCommitDiff(ownerKey, repo.name, info.oid);
		if (format === "diff") addDiff(body, diff);
		else body.add(formatPatchSections(info, diff, 0, 1));
		return true;
	});
}

/**
 * `/{owner}/{repo}/compare/{spec}.diff|.patch`. Only three-dot comparisons
 * (and a lone head) are served; a two-dot `base..head` is 404 until the git
 * library exposes a direct tree-to-tree diff.
 */
export function serveComparePatch(
	owner: string,
	name: string,
	spec: string,
	format: PatchFormat,
): Promise<Response> {
	return render(
		`compare ${spec}.${format}`,
		owner,
		name,
		async (repo, body) => {
			const parsed = parseCompareSpec(spec, repo.owner.username);
			if (parsed?.separator !== "...") return false;
			const base = parsed.base ?? repo.defaultBranch;
			if (
				!safeCommitRevSchema.safeParse(base).success ||
				!safeCommitRevSchema.safeParse(parsed.head).success
			) {
				return false;
			}
			const ownerKey = ownerKeyOf(repo);
			const comparison = await compareRevisions(
				ownerKey,
				repo.name,
				base,
				parsed.head,
			);
			if (format === "diff") addDiff(body, comparison.diff);
			else await addPatches(body, ownerKey, repo.name, comparison.commits);
			return true;
		},
	);
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
	return render(`pull ${number}.${format}`, owner, name, async (repo, body) => {
		if (!/^[1-9][0-9]{0,9}$/.test(number)) return false;
		const pr = await findPullRequestByNumber(repo.id, Number(number));
		if (!pr) return false;
		const merged = pr.status === "merged" && pr.baseSha && pr.headSha;
		const base = merged ? (pr.baseSha as string) : pr.targetBranch;
		const head = merged ? (pr.headSha as string) : pr.sourceBranch;
		const ownerKey = ownerKeyOf(repo);
		const comparison = await compareRevisions(ownerKey, repo.name, base, head);
		if (format === "diff") addDiff(body, comparison.diff);
		else await addPatches(body, ownerKey, repo.name, comparison.commits);
		return true;
	});
}
