import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues } from "#/db/app-schema";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { parseSearchQuery } from "#/lib/search-query";
import {
	requestCodeownerReviews,
	requestCodeownerReviewsFor,
} from "./codeowners";
import { analyzeMerge, getCommitsBetween } from "./git-read";
import { safeBranchNameSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import {
	deleteHeadBranch,
	insertPullRequest,
	mergePullRequestBranches,
	setPullRequestDraft,
	updatePullRequestFields,
} from "./pull-request-store";
import { readInput, threadNumberSchema } from "./read-input";
import {
	canMergePullRequest,
	canModerateRepo,
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import { readRepoByName } from "./repository-lookup";
import { reviewSummaryFor } from "./review-store";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { searchFilter, searchSort } from "./thread-search";
import {
	findPullRequestById,
	findThread,
	listThreads,
	pullRequestView,
} from "./thread-store";

export const createPullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			sourceBranchName: safeBranchNameSchema,
			targetBranchName: safeBranchNameSchema,
			draft: z.boolean().optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, currentUser) => {
			if (data.sourceBranchName === data.targetBranchName) {
				throw new Error("A pull request needs two different branches");
			}
			const { canMerge } = await analyzeMerge(
				ownerKeyOf(repo),
				repo.name,
				data.sourceBranchName,
				data.targetBranchName,
			);
			if (!canMerge) throw new Error("Both branches must exist");

			const created = await insertPullRequest(repo.id, currentUser.id, {
				title: data.title,
				body: data.body,
				sourceBranch: data.sourceBranchName,
				targetBranch: data.targetBranchName,
				draft: data.draft ?? false,
			});
			await requestCodeownerReviews(repo, created);
			return created;
		}),
	);

export const getPullRequests = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
			query: z.string().max(MAX_SEARCH_QUERY_CHARS).default(""),
		}),
	)
	.handler(({ data }) => {
		const search = parseSearchQuery(data.query);
		// `is:issue` can't match the pull request list.
		const matchesNothing = search.matchesNothing || search.type === "issue";
		const status = search.status ?? "open";
		return readWithAccess(
			`getPullRequests ${status}`,
			data.repoId,
			async () => {
				if (matchesNothing) return [];
				const needsViewer =
					search.reviewRequested.length + search.reviewedBy.length > 0;
				const viewer = needsViewer ? await getCurrentUserOptional() : null;
				const { threads } = await listThreads(
					{
						repoId: data.repoId,
						kind: "pull_request",
						// `closed` is closed without merging; `merged` is its own state.
						...(status === "open" && { state: "open" }),
						...(status === "closed" && { state: "closed", merged: false }),
						...(status === "merged" && { state: "closed", merged: true }),
						...searchFilter(search, viewer?.username),
					},
					{
						sort: searchSort(search.sort),
						limit: data.limit,
						offset: data.skip,
					},
				);
				return threads.map(pullRequestView);
			},
		);
	});

export const getPullRequestNumbers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getPullRequestNumbers", data.repoId, async () => {
			const rows = await db
				.select({ number: issues.number })
				.from(issues)
				.where(
					and(eq(issues.repoId, data.repoId), eq(issues.isPullRequest, true)),
				);
			return rows.map((row) => row.number);
		}),
	);

export const getPullRequestByNumber = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				owner: z.string(),
				name: z.string(),
				number: threadNumberSchema,
			}),
		),
	)
	.handler(({ data }) =>
		readRepoByName(
			`getPullRequestByNumber ${data.owner}/${data.name}#${data.number}`,
			data.owner,
			data.name,
			async (repo) => {
				const [thread, viewerAccess, viewer] = await Promise.all([
					findThread(repo.id, data.number, "pull_request"),
					getViewerRepositoryAccess(repo.id),
					getCurrentUserOptional(),
				]);
				if (!thread) throw notFound();
				const pr = pullRequestView(thread);
				return {
					...pr,
					viewer: viewerAccess,
					review: {
						summary: await reviewSummaryFor(pr.id),
						// Approving and requesting changes need write access, and GitHub
						// forbids either on one's own pull request.
						canApprove: viewerAccess.canWrite && viewer?.id !== pr.authorId,
						canResolve: viewerAccess.canWrite || viewer?.id === pr.authorId,
					},
				};
			},
		),
	);

export const updatePullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number(),
			title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS).optional(),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			status: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequestById(data.prId);
		if (!pr) throw notFound();
		if (
			pr.authorId !== currentUser.id &&
			!(await canWriteRepo(pr.repoId, currentUser.id))
		) {
			throw new Error("Access denied");
		}
		// Title and body stay editable after a merge, as on GitHub; its status doesn't.
		if (pr.status === "merged" && data.status !== undefined)
			throw new Error("A merged pull request can't be closed or reopened");
		return updatePullRequestFields(pr, currentUser.id, {
			title: data.title,
			body: data.body,
			status: data.status,
		});
	});

/**
 * Mark a draft ready for review (`draft: false`) or convert an open pull
 * request back to a draft (`draft: true`): the author or anyone with write
 * access, as on GitHub.
 */
export const setPullRequestDraftState = createServerFn({ method: "POST" })
	.validator(z.object({ prId: z.number(), draft: z.boolean() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequestById(data.prId);
		if (!pr) throw notFound();
		if (
			pr.authorId !== currentUser.id &&
			!(await canWriteRepo(pr.repoId, currentUser.id))
		) {
			throw new Error("Access denied");
		}
		const updated = await setPullRequestDraft(pr, currentUser.id, data.draft);
		if (!data.draft) await requestCodeownerReviewsFor(updated);
		return updated;
	});

export const mergePullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number(),
			commitMessage: z.string().trim().max(MAX_COMMIT_MESSAGE_CHARS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequestById(data.prId);
		if (!pr) throw notFound();
		if (!(await canMergePullRequest(pr.repoId, currentUser.id))) {
			throw new Error("Access denied");
		}
		if (pr.status !== "open") throw new Error("Pull request is not open");
		if (pr.isDraft) throw new Error("Pull Request is still a draft");
		// GitHub blocks the merge while a reviewer's latest review requested
		// changes; an owner/admin may override, as GitHub's admin permission can.
		if (
			(await reviewSummaryFor(pr.id)).blocksMerge &&
			!(await canModerateRepo(pr.repoId, currentUser.id))
		) {
			throw new Error("Changes were requested on this pull request");
		}

		return writeWithAccess(pr.repoId, async (repo) => {
			const result = await mergePullRequestBranches(
				repo,
				pr,
				currentUser,
				data.commitMessage,
			);
			if (!result.success) {
				throw new Error(`Merge failed: ${result.conflicts.join(", ")}`);
			}
			return { commitSha: result.commitSha };
		});
	});

/**
 * Delete a merged or closed pull request's head branch, recording
 * `head_ref_deleted` on its timeline (GitHub's "deleted the … branch").
 */
export const deletePullRequestBranch = createServerFn({ method: "POST" })
	.validator(z.object({ prId: z.number() }))
	.handler(async ({ data }) => {
		const pr = await findPullRequestById(data.prId);
		if (!pr) throw notFound();
		if (pr.status === "open") {
			throw new Error(
				"Close or merge the pull request before deleting its branch",
			);
		}
		return writeWithAccess(pr.repoId, async (repo, currentUser) => {
			if (pr.sourceBranch === repo.defaultBranch) {
				throw new Error("Cannot delete the default branch");
			}
			await deleteHeadBranch(repo, pr.sourceBranch, currentUser.id);
		});
	});

/** The Commits tab is capped at 250 commits, as on GitHub. */
const PR_COMMITS_LIMIT = 250;

/**
 * A pull request's Commits tab: commits on the head branch that aren't on
 * the base, oldest first. A merged pull request uses the base and head tips
 * recorded when it merged, so later pushes to either branch don't change it.
 */
export const getPullRequestCommits = createServerFn({ method: "GET" })
	.validator(z.object({ prId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const pr = await findPullRequestById(data.prId);
		if (!pr) throw notFound();
		return readWithAccess(
			`getPullRequestCommits #${pr.number}`,
			pr.repoId,
			async (repo) => {
				if (pr.status === "merged" && !(pr.baseSha && pr.headSha)) {
					throw new Error(`Merged pull request #${pr.number} has no range`);
				}
				const merged = pr.status === "merged";
				return getCommitsBetween(
					ownerKeyOf(repo),
					repo.name,
					(merged ? pr.baseSha : pr.targetBranch) as string,
					(merged ? pr.headSha : pr.sourceBranch) as string,
					PR_COMMITS_LIMIT,
				);
			},
		);
	});
