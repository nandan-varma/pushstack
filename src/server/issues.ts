import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { activities, issues } from "../db/github-schema";
import { perfContext, perfStep } from "./perf-log";
import {
	canWriteRepo,
	getAccessForRepository,
	requireReadAccess,
	requireWriteAccess,
} from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

// ============ ISSUES ============

// Create issue
export const createIssue = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				title: z.string().min(1),
				body: z.string().optional(),
				labels: z.array(z.string()).optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		await requireWriteAccess(data.repoId, user.id);

		const [issue] = await db
			.insert(issues)
			.values({
				repoId: data.repoId,
				authorId: user.id,
				title: data.title,
				body: data.body || null,
				labels: data.labels || null,
				status: "open",
			})
			.returning();

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: data.repoId,
			type: "issue",
			metadata: {
				issueId: issue.id,
				title: issue.title,
				action: "opened",
			},
		});

		return { ...issue, labels: issue.labels as string[] | null };
	});

// Get issues
export const getIssues = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				status: z.enum(["open", "closed", "all"]).optional().default("open"),
			})
			.parse(data),
	)
	.handler(async ({ data }) =>
		perfContext(`getIssues repo=${data.repoId} ${data.status}`, async () => {
			const user = await perfStep("getCurrentUserOptional", () =>
				getCurrentUserOptional(),
			);

			await perfStep("requireReadAccess", () =>
				requireReadAccess(data.repoId, user?.id),
			);

			const issueList = await perfStep("db: issues.findMany", () =>
				db.query.issues.findMany({
					where: and(
						eq(issues.repoId, data.repoId),
						data.status !== "all" ? eq(issues.status, data.status) : undefined,
					),
					with: {
						author: true,
					},
					orderBy: [desc(issues.createdAt)],
				}),
			);

			return issueList.map((issue) => ({
				...issue,
				labels: issue.labels as string[] | null,
			}));
		}),
	);

// Get all issue numbers for a repo — used to resolve `#123` references in
// markdown (commit messages, PR/issue bodies, comments) to issue links.
export const getIssueNumbers = createServerFn({ method: "GET" })
	.validator((data: unknown) => z.object({ repoId: z.number() }).parse(data))
	.handler(async ({ data }) =>
		perfContext(`getIssueNumbers repo=${data.repoId}`, async () => {
			const user = await perfStep("getCurrentUserOptional", () =>
				getCurrentUserOptional(),
			);

			await perfStep("requireReadAccess", () =>
				requireReadAccess(data.repoId, user?.id),
			);

			const rows = await perfStep("db: issues ids", () =>
				db
					.select({ id: issues.id })
					.from(issues)
					.where(eq(issues.repoId, data.repoId)),
			);

			return rows.map((row) => row.id);
		}),
	);

// Get issue by ID
export const getIssue = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				issueId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) =>
		perfContext(`getIssue ${data.issueId}`, async () => {
			const user = await perfStep("getCurrentUserOptional", () =>
				getCurrentUserOptional(),
			);

			const issue = await perfStep("db: issues.findFirst", () =>
				db.query.issues.findFirst({
					where: eq(issues.id, data.issueId),
					with: {
						author: true,
						repository: true,
					},
				}),
			);

			if (!issue) {
				throw new Error("Issue not found");
			}

			// ponytail: the query above already fetched the repository row via the
			// relation — reuse it instead of canReadRepo's own repo fetch.
			const access = await perfStep("getAccessForRepository", () =>
				getAccessForRepository(issue.repository, user?.id),
			);
			if (!access.canRead) {
				throw new Error("Access denied");
			}

			return { ...issue, labels: issue.labels as string[] | null };
		}),
	);

// Update issue
export const updateIssue = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				issueId: z.number(),
				title: z.string().optional(),
				body: z.string().optional(),
				status: z.enum(["open", "closed"]).optional(),
				labels: z.array(z.string()).optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const issue = await db.query.issues.findFirst({
			where: eq(issues.id, data.issueId),
		});

		if (!issue) {
			throw new Error("Issue not found");
		}

		if (
			issue.authorId !== user.id &&
			!(await canWriteRepo(issue.repoId, user.id))
		) {
			throw new Error("Access denied");
		}

		const [updated] = await db
			.update(issues)
			.set({
				...(data.title && { title: data.title }),
				...(data.body !== undefined && { body: data.body }),
				...(data.status && {
					status: data.status,
					closedAt: data.status === "closed" ? new Date() : null,
				}),
				...(data.labels && { labels: data.labels }),
				updatedAt: new Date(),
			})
			.where(eq(issues.id, data.issueId))
			.returning();

		// Log activity if status changed
		if (data.status && data.status !== issue.status) {
			await db.insert(activities).values({
				userId: user.id,
				repoId: issue.repoId,
				type: "issue",
				metadata: {
					issueId: issue.id,
					title: issue.title,
					action: data.status === "closed" ? "closed" : "reopened",
				},
			});
		}

		return { ...updated, labels: updated.labels as string[] | null };
	});
