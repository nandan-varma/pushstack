import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_REVIEWERS_PER_REQUEST } from "#/lib/limits";
import { ownersOfFile } from "./codeowners";
import { safeRefNameSchema, safeRepoPathSchema } from "./git-ref-name";
import {
	canReadRepo,
	canWriteRepo,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import {
	listRequestedReviewers,
	listReviewerCandidates,
	removeReviewRequests,
	requestReviewers,
} from "./review-request-store";
import { getCurrentUser } from "./session";
import { findPullRequestById } from "./thread-store";

/** Who can be asked to review in a repository: its owner and collaborators. */
export const getReviewerCandidates = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getReviewerCandidates", data.repoId, () =>
			listReviewerCandidates(data.repoId),
		),
	);

/** The CODEOWNERS owners of a file at a ref, or null when no rule covers it. */
export const getFileOwners = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			branchName: safeRefNameSchema,
			path: safeRepoPathSchema,
		}),
	)
	.handler(({ data }) =>
		readWithAccess(
			`getFileOwners ${data.branchName}:${data.path}`,
			data.repoId,
			(repo) => ownersOfFile(repo, data.branchName, data.path),
		),
	);

async function authorizedPull(prId: number) {
	const currentUser = await getCurrentUser();
	const pr = await findPullRequestById(prId);
	if (!pr || !(await canReadRepo(pr.repoId, currentUser.id))) throw notFound();
	// GitHub: the author, or anyone with write access, manages review requests.
	if (
		pr.authorId !== currentUser.id &&
		!(await canWriteRepo(pr.repoId, currentUser.id))
	) {
		throw new Error("You don't have permission to manage review requests");
	}
	if (pr.authorId === currentUser.id) {
		await requireParticipateAccess(pr.repoId, currentUser.id);
	}
	return { pr, currentUser };
}

const usernames = z.array(z.string().max(100)).max(MAX_REVIEWERS_PER_REQUEST);

export const requestPullRequestReviewers = createServerFn({ method: "POST" })
	.validator(z.object({ prId: z.number(), usernames }))
	.handler(async ({ data }) => {
		const { pr, currentUser } = await authorizedPull(data.prId);
		await requestReviewers(pr, data.usernames, currentUser.id);
		return listRequestedReviewers(pr.id);
	});

export const removePullRequestReviewRequest = createServerFn({
	method: "POST",
})
	.validator(z.object({ prId: z.number(), usernames }))
	.handler(async ({ data }) => {
		const { pr, currentUser } = await authorizedPull(data.prId);
		await removeReviewRequests(pr, data.usernames, currentUser.id);
		return listRequestedReviewers(pr.id);
	});
