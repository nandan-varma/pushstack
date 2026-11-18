/**
 * `Commit` objects and `Commit.blame`: the part of the repository domain that
 * reads history. `Repository.object`/`ref` and `Ref.target` resolve to commits
 * only (trees, blobs and tags are not served); blame comes from
 * git-fs-s3/ops's `getBlame`, so it is bounded, and a file too large or binary
 * to blame is an UNPROCESSABLE error rather than a timeout.
 */
import { isNotFoundError } from "git-fs-s3";
import { htmlUrl } from "../../api/http";
import {
	type Verification,
	type VerificationReason,
	verifyCommit,
} from "../../commit-verification";
import { getBlame, getCommit } from "../../git-read";
import { safeCommitRevSchema, safeRepoPathSchema } from "../../git-ref-name";
import { ownerKeyOf } from "../../git-storage-naming";
import { notFound, unprocessable } from "../errors";
import { encodeGlobalNodeId } from "../node-id";
import type { CommitBlameArgs, RepositoryObjectArgs } from "./generated";
import type { RepositoryNode } from "./repository";

export interface CommitNode {
	__typename: "Commit";
	id: string;
	oid: string;
	abbreviatedOid: string;
	message: string;
	messageHeadline: string;
	authoredDate: string;
	committedDate: string;
	url: string;
	resourcePath: string;
	repository: RepositoryNode;
	/** Internal: the commit's author, for `Commit.authors`. */
	authorActor: { name: string; email: string; date: string };
}

export function commitNode(
	repo: RepositoryNode,
	commit: Awaited<ReturnType<typeof getCommit>>,
): CommitNode {
	const message = commit.commit.message.trim();
	const path = `/${repo.nameWithOwner}/commit/${commit.oid}`;
	return {
		__typename: "Commit",
		id: encodeGlobalNodeId("Commit", repo.row.id, commit.oid),
		oid: commit.oid,
		abbreviatedOid: commit.oid.slice(0, 7),
		message,
		messageHeadline: message.split("\n")[0] ?? "",
		authoredDate: new Date(commit.commit.author.timestamp * 1000).toISOString(),
		committedDate: new Date(
			commit.commit.committer.timestamp * 1000,
		).toISOString(),
		url: htmlUrl(path),
		resourcePath: path,
		repository: repo,
		authorActor: {
			name: commit.commit.author.name,
			email: commit.commit.author.email,
			date: new Date(commit.commit.author.timestamp * 1000).toISOString(),
		},
	};
}

/** GitHub's `GitSignatureState` value for a REST verification reason. */
const SIGNATURE_STATE = {
	valid: "VALID",
	unsigned: "UNSIGNED",
	unknown_key: "UNKNOWN_KEY",
	bad_email: "BAD_EMAIL",
	unverified_email: "UNVERIFIED_EMAIL",
	no_user: "NO_USER",
	invalid: "INVALID",
	malformed_signature: "MALFORMED_SIG",
	unknown_signature_type: "UNKNOWN_SIG_TYPE",
	expired_key: "EXPIRED_KEY",
	not_signing_key: "NOT_SIGNING_KEY",
} as const satisfies Record<VerificationReason, string>;

export interface GitSignatureNode {
	__typename: "GpgSignature" | "SshSignature" | "UnknownSignature";
	email: string;
	isValid: boolean;
	payload: string;
	signature: string;
	signer: null;
	state: (typeof SIGNATURE_STATE)[VerificationReason];
	verifiedAt: string | null;
	wasSignedByGitHub: boolean;
	keyId?: string | null;
	keyFingerprint?: string | null;
}

function signatureNode(
	email: string,
	verification: Verification,
): GitSignatureNode {
	const typename =
		verification.signatureType === "gpg"
			? "GpgSignature"
			: verification.signatureType === "ssh"
				? "SshSignature"
				: "UnknownSignature";
	return {
		__typename: typename,
		email,
		isValid: verification.verified,
		payload: verification.payload ?? "",
		signature: verification.signature ?? "",
		// Commits aren't linked to accounts by email yet.
		signer: null,
		state: SIGNATURE_STATE[verification.reason],
		verifiedAt: verification.verified_at,
		wasSignedByGitHub: false,
		...(typename === "GpgSignature" && { keyId: verification.keyId ?? null }),
		...(typename === "SshSignature" && {
			keyFingerprint: verification.keyFingerprint ?? null,
		}),
	};
}

/** `Commit.signature`: null when the commit is unsigned, as on GitHub. */
export async function signatureOf(
	commit: CommitNode,
): Promise<GitSignatureNode | null> {
	const ownerKey = ownerKeyOf(commit.repository.row);
	const repoName = commit.repository.row.name;
	const info = await getCommit(ownerKey, repoName, commit.oid);
	const verification = await verifyCommit(ownerKey, repoName, info);
	if (verification.reason === "unsigned") return null;
	return signatureNode(info.commit.committer.email, verification);
}

/** The commit a branch, `HEAD` or sha names, or null (also for an invalid name). */
export async function readCommitNode(
	repo: RepositoryNode,
	rev: string,
): Promise<CommitNode | null> {
	// The revision is caller-controlled and reaches storage paths: only a
	// branch name, `HEAD` or a sha is looked up (anything else is null, with
	// no storage read).
	if (!safeCommitRevSchema.safeParse(rev).success) return Promise.resolve(null);
	return readValidCommitNode(repo, rev);
}

async function readValidCommitNode(
	repo: RepositoryNode,
	rev: string,
): Promise<CommitNode | null> {
	try {
		return commitNode(
			repo,
			await getCommit(ownerKeyOf(repo.row), repo.row.name, rev),
		);
	} catch (error) {
		if (isNotFoundError(error) || error instanceof RangeError) return null;
		throw error;
	}
}

/** `Repository.object(expression:)`: a commit by branch, `HEAD` or full sha. */
export function resolveObject(
	repo: RepositoryNode,
	args: RepositoryObjectArgs,
): Promise<CommitNode | null> {
	const rev = args.oid ?? args.expression;
	// `branch:path` names a tree or blob, which are not served.
	if (!rev || rev.includes(":")) return Promise.resolve(null);
	return readCommitNode(repo, rev);
}

interface BlameRangeNode {
	startingLine: number;
	endingLine: number;
	age: number;
	commit: CommitNode;
}

/**
 * GitHub's age: 1 (new) to 10 (old), by where the range's commit date falls
 * among the file's commit dates (newest 1, oldest 10).
 */
function ageOf(time: number, times: number[]): number {
	if (times.length < 2) return 1;
	const rank = times.indexOf(time) / (times.length - 1);
	return 10 - Math.round(rank * 9);
}

export async function blameOf(
	commit: CommitNode,
	args: CommitBlameArgs,
): Promise<{ ranges: BlameRangeNode[] }> {
	const path = safeRepoPathSchema.safeParse(args.path);
	if (!path.success || !path.data) {
		throw unprocessable(`Invalid path '${args.path}'.`);
	}
	const repo = commit.repository;
	let blame: Awaited<ReturnType<typeof getBlame>>;
	try {
		blame = await getBlame(
			ownerKeyOf(repo.row),
			repo.row.name,
			commit.oid,
			path.data,
		);
	} catch (error) {
		if (isNotFoundError(error)) {
			throw notFound(`Could not resolve to a path '${path.data}'.`);
		}
		throw error;
	}
	if (blame.kind === "binary") {
		throw unprocessable("Cannot blame a binary file.");
	}
	if (blame.kind === "too-large") {
		throw unprocessable(
			`File exceeds the blame limit of ${blame.limit} ${blame.metric}.`,
		);
	}

	const times = [
		...new Set(
			Object.values(blame.commits).map((c) => Date.parse(c.createdAt)),
		),
	].sort((a, b) => a - b);
	const nodes = new Map<string, CommitNode>();
	const nodeFor = async (sha: string) => {
		let node = nodes.get(sha);
		if (!node) {
			const read = await readCommitNode(repo, sha);
			if (!read) throw notFound(`Could not resolve to a Commit '${sha}'.`);
			node = read;
			nodes.set(sha, node);
		}
		return node;
	};
	const ranges: BlameRangeNode[] = [];
	for (const range of blame.ranges) {
		const info = blame.commits[range.sha];
		ranges.push({
			startingLine: range.startLine,
			endingLine: range.endLine,
			age: ageOf(info ? Date.parse(info.createdAt) : (times[0] ?? 0), times),
			commit: await nodeFor(range.sha),
		});
	}
	return { ranges };
}
