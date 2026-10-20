/** Server functions for issues. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments, issues } from "#/db/app-schema";
import {
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
} from "#/lib/limits";
import { parseSearchQuery } from "#/lib/search-query";
import { andFilter } from "./db-filters";
import {
	createIssueForUser,
	issueLabelsSchema,
	updateIssueThreadFields,
	withAssignees,
} from "./issue-store";
import { withLabels } from "./label-store";
import { readInput, threadNumberSchema } from "./read-input";
import {
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import { publicUserFields, readRepoByName } from "./repository-lookup";
import { getCurrentUser } from "./session";
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

export const createIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(256),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			labels: issueLabelsSchema.default([]),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		await requireParticipateAccess(data.repoId, currentUser.id);
		// Labels are triage: a participant without write access opens the issue
		// unlabeled, as on GitHub.
		const labels = (await canWriteRepo(data.repoId, currentUser.id))
			? data.labels
			: [];
		return createIssueForUser(data.repoId, currentUser.id, {
			title: data.title,
			body: data.body,
			labels,
		});
	});

export const getIssues = createServerFn({ method: "GET" })
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
		const requested = search.status ?? "open";
		// An issue can't be merged, and `is:pr` can't match the issues list.
		const matchesNothing =
			search.matchesNothing || search.type === "pr" || requested === "merged";
		const status: "open" | "closed" | "all" =
			requested === "merged" ? "open" : requested;
		const assignees = [
			...(search.noAssignee ? ["none"] : []),
			...search.assignees,
		];
		const conditions: ThreadCondition[] = [];
		const add = (condition: ThreadCondition | undefined) => {
			if (condition) conditions.push(condition);
		};
		add(textCondition(search.terms));
		add(authorCondition(search.authors));
		add(mentionsCondition(search.mentions, comments.issueId));
		add(labelCondition(data.repoId, search.labels, search.noLabel));
		add(assigneesCondition(assignees));
		return readWithAccess(`getIssues ${status}`, data.repoId, async () => {
			if (matchesNothing) return [];
			return withLabels(
				data.repoId,
				await db.query.issues.findMany({
					where: {
						repoId: data.repoId,
						...(status === "all" ? {} : { status }),
						// andFilter owns the "never pass an empty AND array" rule
						// (Drizzle 1.0 rejects one); rawConditions maps the shared
						// ThreadConditions onto relational RAW filters.
						...andFilter(rawConditions(conditions)),
					},
					with: { author: publicUserFields, ...withAssignees },
					orderBy: threadOrderBy(search.sort, comments.issueId),
					limit: data.limit,
					offset: data.skip,
				}),
			);
		});
	});

/** Every issue number in a repository (resolves `#N` references in markdown). */
export const getIssueNumbers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getIssueNumbers", data.repoId, async () => {
			const rows = await db
				.select({ number: issues.number })
				.from(issues)
				.where(eq(issues.repoId, data.repoId));
			return rows.map((row) => row.number);
		}),
	);

/** An issue by its repo-scoped number (the `#N` in URLs). */
export const getIssueByNumber = createServerFn({ method: "GET" })
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
			`getIssueByNumber ${data.owner}/${data.name}#${data.number}`,
			data.owner,
			data.name,
			async (repo) => {
				const issue = await db.query.issues.findFirst({
					where: {
						repoId: repo.id,
						number: data.number,
					},
					with: { author: publicUserFields, ...withAssignees },
				});
				if (!issue) throw notFound();
				const [withIssueLabels] = await withLabels(repo.id, [issue]);
				return {
					...issue,
					labels: withIssueLabels?.labels ?? [],
					viewer: await getViewerRepositoryAccess(repo.id),
				};
			},
		),
	);

export const updateIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			issueId: z.number(),
			title: z.string().trim().min(1).max(256).optional(),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			status: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const issue = await db.query.issues.findFirst({
			where: { id: data.issueId },
		});
		if (!issue) throw notFound();
		// The author may edit, close and reopen their own issue; anyone else's
		// needs write access.
		const canWrite = await canWriteRepo(issue.repoId, currentUser.id);
		if (!canWrite && issue.authorId !== currentUser.id) {
			throw new Error("Access denied");
		}
		const { issueId, status, ...fields } = data;
		return updateIssueThreadFields(issue, currentUser.id, {
			...fields,
			status,
		});
	});
