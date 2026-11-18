/**
 * Opening a pull request, shared by the REST API and GraphQL
 * `createPullRequest`: the head is a branch of the repository, or a branch of
 * a fork in its network, copied in and pinned as `refs/pull/<n>/head`.
 */
import { analyzeMerge, getBranches } from "./git-read";
import { safeBranchNameSchema } from "./git-ref-name";
import { repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { ownerKeyOf } from "./git-storage-naming";
import { pinPullHeadUnlocked } from "./git-write";
import { acceptForkHead, findForkHead, tipOf } from "./pull-head";
import { insertPullRequest, type PullRequest } from "./pull-request-store";
import type { RepositoryRowWithOwner } from "./repository-lookup";
import { listThreads } from "./thread-store";

/** Why a pull request was refused: a bad `head` or `base`, or a custom message. */
export class PullCreateError extends Error {
	constructor(
		message: string,
		readonly field?: "head" | "base",
	) {
		super(message);
	}
}

/** The caller may not open this pull request (a branch of the repository needs write access). */
export class PullForbiddenError extends Error {
	constructor() {
		super("You do not have permission to create pull requests");
	}
}

export interface PullHeadInput {
	/** The branch name, without an owner. */
	branch: string;
	/** The owner of `owner:branch`; another owner than the base's names a fork. */
	owner: string | null;
	/** The fork's name when it is not called like the base (REST `head_repo`). */
	repoName?: string;
	/** The fork itself (GraphQL `headRepositoryId`), already resolved. */
	repo?: RepositoryRowWithOwner;
}

export interface CreatePullInput {
	repo: RepositoryRowWithOwner;
	userId: string;
	/** Write access to `repo`; a head from a fork needs only read access to both. */
	canWrite: boolean;
	title: string;
	body?: string;
	draft?: boolean;
	base: string;
	head: PullHeadInput;
}

const invalid = (field: "head" | "base") =>
	new PullCreateError(`${field} is invalid`, field);

/** Validate `input` and open the pull request; throws {@link PullCreateError}. */
export async function createPullRequest(
	input: CreatePullInput,
): Promise<PullRequest> {
	const { repo, head } = input;
	if (!safeBranchNameSchema.safeParse(head.branch).success)
		throw invalid("head");
	if (!safeBranchNameSchema.safeParse(input.base).success)
		throw invalid("base");
	const ownerKey = ownerKeyOf(repo);
	const tips = new Map(
		(await getBranches(ownerKey, repo.name)).map((b) => [b.name, b.commit]),
	);
	const targetTip = tips.get(input.base);
	if (targetTip === undefined) throw invalid("base");

	const sameRepo =
		head.repo?.id === repo.id ||
		(head.repo === undefined &&
			(head.owner === null ||
				head.owner.toLowerCase() === repo.owner.username.toLowerCase()));
	let fork: RepositoryRowWithOwner | null = null;
	let forkTip: string | null = null;
	if (sameRepo) {
		if (!input.canWrite) throw new PullForbiddenError();
		if (!tips.has(head.branch)) throw invalid("head");
		if (head.branch === input.base) {
			throw new PullCreateError(
				`No commits between ${input.base} and ${head.branch}`,
			);
		}
		const { canMerge } = await analyzeMerge(
			ownerKey,
			repo.name,
			head.branch,
			input.base,
		);
		if (!canMerge) throw invalid("head");
	} else {
		fork = head.repo
			? await acceptForkHead(repo, head.repo, input.userId)
			: await findForkHead(
					repo,
					head.owner as string,
					head.repoName ?? repo.name,
					input.userId,
				);
		forkTip = fork
			? await tipOf(
					repoFor(ownerKeyOf(fork), fork.name),
					`refs/heads/${head.branch}`,
				)
			: null;
		if (!fork || forkTip === null) throw invalid("head");
	}
	const headOwner = fork ? fork.owner.username : null;
	const label = `${headOwner ?? repo.owner.username}:${head.branch}`;

	// Check-then-insert must be atomic per repository, or two concurrent
	// creates for the same head both pass the duplicate check.
	return withRepositoryLock(ownerKey, repo.name, async () => {
		const duplicate = await listThreads(
			{
				repoId: repo.id,
				kind: "pull_request",
				state: "open",
				head: head.branch,
				...(headOwner !== null && { headOwner }),
				base: input.base,
			},
			{ limit: 1 },
		);
		if (duplicate.total > 0) {
			throw new PullCreateError(`A pull request already exists for ${label}.`);
		}
		const forkRepo = fork && repoFor(ownerKeyOf(fork), fork.name);
		const tip = forkTip;
		return insertPullRequest(repo.id, input.userId, {
			title: input.title,
			body: input.body,
			sourceBranch: head.branch,
			targetBranch: input.base,
			draft: input.draft ?? false,
			head:
				fork && forkRepo && tip
					? {
							repoId: fork.id,
							owner: fork.owner.username,
							pin: (number) =>
								pinPullHeadUnlocked(
									repoFor(ownerKey, repo.name),
									forkRepo,
									number,
									tip,
									[targetTip],
								),
						}
					: undefined,
		});
	});
}
