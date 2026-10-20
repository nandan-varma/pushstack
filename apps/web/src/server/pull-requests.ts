/** Server functions for pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments, pullRequests } from "#/db/app-schema";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { parseSearchQuery } from "#/lib/search-query";
import { andFilter } from "./db-filters";
import { analyzeMerge, getCommitsBetween } from "./git-read";
import { safeBranchNameSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { deleteBranch } from "./git-write";
import { withAssignees } from "./issue-store";
import { withLabels } from "./label-store";
import {
	insertPullRequest,
	mergePullRequestBranches,
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
import { publicUserFields, readRepoByName } from "./repository-lookup";
import { reviewSummaryFor } from "./review-store";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import {
	assigneesCondition,
	authorCondition,
	labelCondition,
	mentionsCondition,
	rawConditions,
	type ThreadCondition,
	textCondition,
	threadOrderBy,
} from "./thread-search";
import { recordTimelineEvent } from "./timeline-store";

export const createPullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			sourceBranchName: safeBranchNameSchema,
			targetBranchName: safeBranchNameSchema,
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

			return insertPullRequest(repo.id, currentUser.id, {
				title: data.title,
				body: data.body,
				sourceBranch: data.sourceBranchName,
				targetBranch: data.targetBranchName,
			});
		}),
	);

export const getPullRequests = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
			/** A GitHub query string (`?q=`); the only list filter. */
			query: z.string().max(MAX_SEARCH_QUERY_CHARS).default(""),
		}),
	)
	.handler(({ data }) => {
		const search = parseSearchQuery(data.query);
		// `is:issue` can't match the pull request list.
		const matchesNothing = search.matchesNothing || search.type === "issue";
		const status = search.status ?? "open";
		const conditions: ThreadCondition[] = [];
		const add = (condition: ThreadCondition | undefined) => {
			if (condition) conditions.push(condition);
		};
		add(textCondition(search.terms));
		add(authorCondition(search.authors));
		add(mentionsCondition(search.mentions, comments.pullRequestId));
		add(labelCondition(data.repoId, search.labels, search.noLabel));
		add(
			assigneesCondition([
				...(search.noAssignee ? ["none"] : []),
				...search.assignees,
			]),
		);
		return readWithAccess(
			`getPullRequests ${status}`,
			data.repoId,
			async () => {
				if (matchesNothing) return [];
				return withLabels(
					data.repoId,
					await db.query.pullRequests.findMany({
						where: {
							repoId: data.repoId,
							...(status === "all" ? {} : { status }),
							// Same idiom as getIssues: andFilter omits the key when
							// there is no condition (Drizzle 1.0 rejects an empty AND).
							...andFilter(rawConditions(conditions)),
						},
						with: { author: publicUserFields, ...withAssignees },
						orderBy: threadOrderBy(search.sort, comments.pullRequestId),
						limit: data.limit,
						offset: data.skip,
					}),
				);
			},
		);
	});

/** Every pull request number in a repository (resolves `#N` references in markdown). */
export const getPullRequestNumbers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getPullRequestNumbers", data.repoId, async () => {
			const rows = await db
				.select({ number: pullRequests.number })
				.from(pullRequests)
				.where(eq(pullRequests.repoId, data.repoId));
			return rows.map((row) => row.number);
		}),
	);

/** A pull request by its repo-scoped number (the `#N` in URLs). */
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
				const pr = await db.query.pullRequests.findFirst({
					where: {
						repoId: repo.id,
						number: data.number,
					},
					with: { author: publicUserFields, ...withAssignees },
				});
				if (!pr) throw notFound();
				const [withPrLabels] = await withLabels(repo.id, [pr]);
				const viewerAccess = await getViewerRepositoryAccess(repo.id);
				const viewer = await getCurrentUserOptional();
				return {
					...pr,
					labels: withPrLabels?.labels ?? [],
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
		const pr = await db.query.pullRequests.findFirst({
			where: { id: data.prId },
		});
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

export const mergePullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number(),
			commitMessage: z.string().trim().max(MAX_COMMIT_MESSAGE_CHARS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await db.query.pullRequests.findFirst({
			where: { id: data.prId },
		});
		if (!pr) throw notFound();
		if (!(await canMergePullRequest(pr.repoId, currentUser.id))) {
			throw new Error("Access denied");
		}
		if (pr.status !== "open") throw new Error("Pull request is not open");
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
		const pr = await db.query.pullRequests.findFirst({
			where: { id: data.prId },
		});
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
			await deleteBranch(ownerKeyOf(repo), repo.name, pr.sourceBranch);
			await recordTimelineEvent(pr.repoId, pr.number, currentUser.id, {
				event: "head_ref_deleted",
				branch: pr.sourceBranch,
			});
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
		const pr = await db.query.pullRequests.findFirst({
			where: { id: data.prId },
		});
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
