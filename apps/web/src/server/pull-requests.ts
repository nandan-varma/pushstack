/** Server functions for pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments, issues, pullRequests } from "#/db/app-schema";
import { getClosingIssueNumbers } from "#/lib/issue-references";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { parseSearchQuery } from "#/lib/search-query";
import { recordActivity } from "./activity";
import { andFilter } from "./db-filters";
import { analyzeMerge, getCommitsBetween } from "./git-read";
import { safeBranchNameSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { deleteBranch, mergeBranches } from "./git-write";
import { withLabels } from "./label-store";
import { readInput, threadNumberSchema } from "./read-input";
import {
	canMergePullRequest,
	canModerateRepo,
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";
import {
	claimNextIssueOrPrNumber,
	publicUserFields,
	readRepoByName,
} from "./repository-lookup";
import { reviewSummaryFor } from "./review-store";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import {
	authorCondition,
	labelCondition,
	mentionsCondition,
	rawConditions,
	type ThreadCondition,
	textCondition,
	threadOrderBy,
} from "./thread-search";
import {
	recordCrossReferences,
	recordTimelineEvent,
	recordTimelineEvents,
} from "./timeline-store";

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

			const [pr] = await db
				.insert(pullRequests)
				.values({
					repoId: repo.id,
					number: await claimNextIssueOrPrNumber(repo.id),
					authorId: currentUser.id,
					title: data.title,
					body: data.body || null,
					sourceBranch: data.sourceBranchName,
					targetBranch: data.targetBranchName,
				})
				.returning();
			if (!pr) throw new Error("Pull request insert returned no row");
			await recordCrossReferences(
				repo.id,
				{ kind: "pull_request", number: pr.number, title: pr.title },
				pr.body,
				currentUser.id,
			);
			await recordActivity(currentUser.id, repo.id, {
				type: "pr",
				metadata: { number: pr.number, title: pr.title, action: "opened" },
			});
			return pr;
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
						with: { author: publicUserFields },
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
					with: { author: publicUserFields },
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
		const { prId, ...fields } = data;
		const titleChanged =
			fields.title !== undefined && fields.title !== pr.title;
		const bodyChanged =
			fields.body !== undefined && (fields.body || null) !== pr.body;
		const [updated] = await db
			.update(pullRequests)
			.set({
				...fields,
				...(fields.body !== undefined && { body: fields.body || null }),
				...(bodyChanged && { editedAt: new Date() }),
				updatedAt: new Date(),
			})
			.where(eq(pullRequests.id, prId))
			.returning();
		if (!updated) throw notFound();
		if (titleChanged) {
			await recordTimelineEvent(pr.repoId, pr.number, currentUser.id, {
				event: "renamed",
				from: pr.title,
				to: updated.title,
			});
		}
		if (bodyChanged) {
			await recordCrossReferences(
				pr.repoId,
				{ kind: "pull_request", number: pr.number, title: updated.title },
				fields.body,
				currentUser.id,
			);
		}
		if (data.status && data.status !== pr.status) {
			const action = data.status === "closed" ? "closed" : "reopened";
			await recordTimelineEvent(pr.repoId, pr.number, currentUser.id, {
				event: action,
			});
			await recordActivity(currentUser.id, pr.repoId, {
				type: "pr",
				metadata: { number: pr.number, title: pr.title, action },
			});
		}
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
			const result = await mergeBranches(
				ownerKeyOf(repo),
				repo.name,
				pr.sourceBranch,
				pr.targetBranch,
				{
					message:
						data.commitMessage ||
						`Merge pull request #${pr.number}: ${pr.title}`,
					authorName: currentUser.name,
					authorEmail: currentUser.email,
				},
			);
			if (!result.success) {
				throw new Error(`Merge failed: ${result.conflicts.join(", ")}`);
			}

			// Conditional on still being open: of two concurrent merges, only one
			// records the merge (the other's merge was a no-op on git's side).
			const [merged] = await db
				.update(pullRequests)
				.set({
					status: "merged",
					mergedAt: new Date(),
					mergedBy: currentUser.id,
					mergeCommitSha: result.commitSha,
					baseSha: result.baseSha,
					headSha: result.headSha,
					updatedAt: new Date(),
				})
				.where(and(eq(pullRequests.id, pr.id), eq(pullRequests.status, "open")))
				.returning({ id: pullRequests.id });
			if (!merged) return { commitSha: result.commitSha };
			await recordTimelineEvent(pr.repoId, pr.number, currentUser.id, {
				event: "merged",
				commitSha: result.commitSha,
				base: pr.targetBranch,
			});

			const closing = getClosingIssueNumbers(pr.body);
			if (closing.length > 0) {
				const closedIssues = await db
					.update(issues)
					.set({
						status: "closed",
						closedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(issues.repoId, pr.repoId),
							inArray(issues.number, closing),
							eq(issues.status, "open"),
						),
					)
					.returning({ number: issues.number });
				await recordTimelineEvents(
					pr.repoId,
					closedIssues.map((issue) => issue.number),
					currentUser.id,
					{
						event: "closed",
						closer: {
							kind: "pull_request",
							number: pr.number,
							title: pr.title,
						},
					},
				);
			}
			await recordActivity(currentUser.id, pr.repoId, {
				type: "pr",
				metadata: { number: pr.number, title: pr.title, action: "merged" },
			});
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
