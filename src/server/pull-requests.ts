/** Server functions for pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues, pullRequests } from "#/db/app-schema";
import { getClosingIssueNumbers } from "#/lib/issue-references";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LIST_SKIP,
} from "#/lib/limits";
import { recordActivity } from "./activity";
import { analyzeMerge, getCommit, getCommitsBetween } from "./git-read";
import { safeBranchNameSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import { deleteBranch, mergeBranches } from "./git-write";
import {
	canMergePullRequest,
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
import { getCurrentUser } from "./session";
import {
	recordCrossReferences,
	recordTimelineEvent,
	recordTimelineEvents,
} from "./timeline-store";

export const createPullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(256),
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
			status: z.enum(["open", "closed", "merged", "all"]).default("open"),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(({ data }) =>
		readWithAccess(`getPullRequests ${data.status}`, data.repoId, () =>
			db.query.pullRequests.findMany({
				where: and(
					eq(pullRequests.repoId, data.repoId),
					data.status === "all"
						? undefined
						: eq(pullRequests.status, data.status),
				),
				with: { author: publicUserFields },
				orderBy: [desc(pullRequests.createdAt)],
				limit: data.limit,
				offset: data.skip,
			}),
		),
	);

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
		z.object({ owner: z.string(), name: z.string(), number: z.number().int() }),
	)
	.handler(({ data }) =>
		readRepoByName(
			`getPullRequestByNumber ${data.owner}/${data.name}#${data.number}`,
			data.owner,
			data.name,
			async (repo) => {
				const pr = await db.query.pullRequests.findFirst({
					where: and(
						eq(pullRequests.repoId, repo.id),
						eq(pullRequests.number, data.number),
					),
					with: { author: publicUserFields },
				});
				if (!pr) throw notFound();
				return { ...pr, viewer: await getViewerRepositoryAccess(repo.id) };
			},
		),
	);

export const updatePullRequest = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number(),
			title: z.string().trim().min(1).max(256).optional(),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			status: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.id, data.prId),
		});
		if (!pr) throw notFound();
		if (
			pr.authorId !== currentUser.id &&
			!(await canWriteRepo(pr.repoId, currentUser.id))
		) {
			throw new Error("Access denied");
		}
		if (pr.status === "merged")
			throw new Error("A merged pull request can't be changed");
		const { prId, ...fields } = data;
		const [updated] = await db
			.update(pullRequests)
			.set({ ...fields, updatedAt: new Date() })
			.where(eq(pullRequests.id, prId))
			.returning();
		if (!updated) throw notFound();
		if (fields.body !== undefined) {
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
			where: eq(pullRequests.id, data.prId),
		});
		if (!pr) throw notFound();
		if (!(await canMergePullRequest(pr.repoId, currentUser.id))) {
			throw new Error("Access denied");
		}
		if (pr.status !== "open") throw new Error("Pull request is not open");

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
			where: eq(pullRequests.id, data.prId),
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
 * the base, newest first. A merged pull request uses the state recorded at
 * merge time: the merge commit's two parents are the base and head then. A
 * fast-forward merge makes no merge commit, so its range can't be recovered
 * and comes back empty with a note.
 */
export const getPullRequestCommits = createServerFn({ method: "GET" })
	.validator(z.object({ prId: z.number() }))
	.handler(async ({ data }) => {
		const pr = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.id, data.prId),
		});
		if (!pr) throw notFound();
		return readWithAccess(
			`getPullRequestCommits #${pr.number}`,
			pr.repoId,
			async (repo) => {
				const owner = ownerKeyOf(repo);
				if (pr.status !== "merged") {
					return {
						...(await getCommitsBetween(
							owner,
							repo.name,
							pr.targetBranch,
							pr.sourceBranch,
							PR_COMMITS_LIMIT,
						)),
						note: null,
					};
				}
				const merge = pr.mergeCommitSha
					? await getCommit(owner, repo.name, pr.mergeCommitSha)
					: null;
				const [mergeBase, mergeHead] = merge?.commit.parent ?? [];
				if (!mergeBase || !mergeHead) {
					return {
						commits: [],
						truncated: false,
						note: "This pull request was fast-forward merged, so its commits weren't recorded.",
					};
				}
				return {
					...(await getCommitsBetween(
						owner,
						repo.name,
						mergeBase,
						mergeHead,
						PR_COMMITS_LIMIT,
					)),
					note: null,
				};
			},
		);
	});
