import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues } from "#/db/app-schema";
import {
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_SEARCH_QUERY_CHARS,
	MAX_TEMPLATE_FILENAME_CHARS,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { parseSearchQuery } from "#/lib/search-query";
import { replaceThreadAssignees } from "./assignees-store";
import {
	createIssueForUser,
	issueLabelsSchema,
	updateIssueThreadFields,
} from "./issue-store";
import { listLabels } from "./label-store";
import { readInput, threadNumberSchema } from "./read-input";
import {
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	requireNotArchived,
	requireParticipateAccess,
} from "./repo-access";
import { readRepoByName } from "./repository-lookup";
import { loadRepositoryTemplates } from "./repository-templates-store";
import { getCurrentUser } from "./session";
import { searchFilter, searchSort } from "./thread-search";
import {
	findIssueById,
	findThread,
	issueView,
	listThreads,
} from "./thread-store";

export const createIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			labels: issueLabelsSchema.optional(),
			assignees: z.array(z.string().max(100)).max(MAX_ASSIGNEES).optional(),
			template: z.string().min(1).max(MAX_TEMPLATE_FILENAME_CHARS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		await requireParticipateAccess(data.repoId, currentUser.id);
		// A template's metadata is trusted repository configuration. Resolve it at
		// the default branch rather than trusting a reporter's submitted labels.
		const template = data.template
			? await readWithAccess(
					"createIssue template",
					data.repoId,
					async (repo) => {
						const templates = await loadRepositoryTemplates(repo);
						const selected = templates.issueTemplates.find(
							(item) => item.filename === data.template,
						);
						if (!selected) throw notFound();
						return selected;
					},
				)
			: undefined;
		const knownLabels = template ? await listLabels(data.repoId) : [];
		const templateLabels = knownLabels
			.filter((label) =>
				template?.labels.some(
					(name) => name.toLowerCase() === label.name.toLowerCase(),
				),
			)
			.map((label) => label.name);
		const canWrite = await canWriteRepo(data.repoId, currentUser.id);
		const labels = canWrite ? (data.labels ?? templateLabels) : templateLabels;
		const assignees = canWrite
			? (data.assignees ?? template?.assignees ?? [])
			: (template?.assignees ?? []);
		const issue = await createIssueForUser(data.repoId, currentUser.id, {
			title: data.title,
			body: data.body,
			labels,
		});
		if (assignees.length > 0)
			await replaceThreadAssignees(issue, assignees, currentUser.id);
		return issue;
	});

export const getIssues = createServerFn({ method: "GET" })
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
		const requested = search.status ?? "open";
		// An issue can't be merged, and `is:pr` can't match the issues list.
		const matchesNothing =
			search.matchesNothing || search.type === "pr" || requested === "merged";
		const status = requested === "merged" ? "open" : requested;
		return readWithAccess(`getIssues ${status}`, data.repoId, async () => {
			if (matchesNothing) return [];
			const { threads } = await listThreads(
				{
					repoId: data.repoId,
					kind: "issue",
					...(status !== "all" && { state: status }),
					...searchFilter(search),
				},
				{
					sort: searchSort(search.sort),
					limit: data.limit,
					offset: data.skip,
				},
			);
			return threads.map(issueView);
		});
	});

export const getIssueNumbers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getIssueNumbers", data.repoId, async () => {
			const rows = await db
				.select({ number: issues.number })
				.from(issues)
				.where(
					and(eq(issues.repoId, data.repoId), eq(issues.isPullRequest, false)),
				);
			return rows.map((row) => row.number);
		}),
	);

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
				const [issue, viewer] = await Promise.all([
					findThread(repo.id, data.number, "issue"),
					getViewerRepositoryAccess(repo.id),
				]);
				if (!issue) throw notFound();
				return { ...issueView(issue), viewer };
			},
		),
	);

export const updateIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			issueId: z.number(),
			title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS).optional(),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			status: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const issue = await findIssueById(data.issueId);
		if (!issue) throw notFound();
		// The author may edit, close and reopen their own issue; anyone else's
		// needs write access.
		await requireNotArchived(issue.repoId);
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
