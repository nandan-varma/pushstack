/**
 * Loading and serializing issue/PR threads for the REST API. The issues
 * endpoints return pull requests too (GitHub does the same), so a "thread row"
 * is whatever the shared `#N` resolves to; the serializers then add the
 * `pull_request` object for a pull request.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { issues, pullRequests } from "#/db/app-schema";
import { user } from "#/db/schema";
import type { LabelView } from "#/lib/labels";
import type { IssueStateReason } from "#/lib/timeline-types";
import { assigneesByThread } from "../assignees-store";
import { commentCountsByNumbers } from "../comment-store";
import { labelsByThread } from "../label-store";
import {
	type PublicUser,
	publicUserColumns,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import type { ThreadKind } from "../thread-store";
import { notFoundError } from "./http";
import { issue } from "./serializers";

/** An issue or pull request as an issues endpoint returns it. */
export interface ThreadRow {
	kind: ThreadKind;
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	createdAt: Date;
	updatedAt: Date;
	closedAt: Date | null;
	/** Issues only; a closed issue without a stored reason was completed. */
	stateReason: IssueStateReason | null;
	mergedAt: Date | null;
	author: PublicUser;
}

export interface ThreadMeta {
	labels: Map<number, LabelView[]>;
	assignees: Map<number, PublicUser[]>;
	comments: Map<number, number>;
}

export const fullNameOf = (repo: RepositoryRowWithOwner) =>
	`${repo.owner.username}/${repo.name}`;

/** The route's `:number`; anything that isn't a positive integer is a 404. */
export function threadNumber(raw: string | undefined): number {
	if (!raw || !/^\d+$/.test(raw)) throw notFoundError();
	const number = Number(raw);
	if (number < 1) throw notFoundError();
	return number;
}

/** The threads numbered in `numbers`, both kinds, with their authors. */
export async function findThreadRowsByNumber(
	repoId: number,
	numbers: number[],
): Promise<ThreadRow[]> {
	if (numbers.length === 0) return [];
	const [issueRows, pullRequestRows] = await Promise.all([
		db
			.select({ row: issues, author: publicUserColumns })
			.from(issues)
			.innerJoin(user, eq(user.id, issues.authorId))
			.where(and(eq(issues.repoId, repoId), inArray(issues.number, numbers))),
		db
			.select({ row: pullRequests, author: publicUserColumns })
			.from(pullRequests)
			.innerJoin(user, eq(user.id, pullRequests.authorId))
			.where(
				and(
					eq(pullRequests.repoId, repoId),
					inArray(pullRequests.number, numbers),
				),
			),
	]);
	return threadRowsOf(issueRows, pullRequestRows);
}

type IssueRecord = typeof issues.$inferSelect;
type PullRequestRecord = typeof pullRequests.$inferSelect;
type ThreadAuthor = ThreadRow["author"];

/** Issue and pull-request rows (with their authors) as the issues surface sees them. */
export function threadRowsOf(
	issueRows: { row: IssueRecord; author: ThreadAuthor }[],
	pullRequestRows: { row: PullRequestRecord; author: ThreadAuthor }[],
): ThreadRow[] {
	return [
		...issueRows.map(({ row, author }) => ({
			kind: "issue" as const,
			id: row.id,
			number: row.number,
			title: row.title,
			body: row.body,
			state: row.status,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			closedAt: row.closedAt,
			stateReason:
				row.status === "closed"
					? (row.stateReason ?? "completed")
					: row.stateReason,
			mergedAt: null,
			author,
		})),
		...pullRequestRows.map(({ row, author }) => ({
			kind: "pull_request" as const,
			id: row.id,
			number: row.number,
			title: row.title,
			body: row.body,
			// A merged pull request is `closed` in the issues surface.
			state: row.status === "open" ? ("open" as const) : ("closed" as const),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			// There is no closed_at column: a merge's time, else the last change.
			closedAt: row.status === "open" ? null : (row.mergedAt ?? row.updatedAt),
			stateReason: null,
			mergedAt: row.mergedAt,
			author,
		})),
	];
}

/** Labels, assignees and comment counts for one page of threads, in three queries. */
export async function loadThreadMeta(
	repoId: number,
	rows: ThreadRow[],
): Promise<ThreadMeta> {
	const [labels, assignees, comments] = await Promise.all([
		labelsByThread(
			repoId,
			rows.map((row) => row.number),
		),
		assigneesByThread(
			repoId,
			rows.map((row) => row.number),
		),
		commentCountsByNumbers(
			repoId,
			rows.map((row) => row.number),
		),
	]);
	return { labels, assignees, comments };
}

export function serializeThread(
	repo: RepositoryRowWithOwner,
	row: ThreadRow,
	meta: ThreadMeta,
	closedBy?: PublicUser | null,
): Record<string, unknown> {
	return issue({
		fullName: fullNameOf(repo),
		kind: row.kind,
		id: row.id,
		number: row.number,
		title: row.title,
		body: row.body,
		state: row.state,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		closedAt: row.closedAt,
		stateReason: row.stateReason,
		closedBy,
		mergedAt: row.mergedAt,
		author: row.author,
		labels: meta.labels.get(row.number) ?? [],
		assignees: meta.assignees.get(row.number) ?? [],
		commentsCount: meta.comments.get(row.number) ?? 0,
	});
}

/** The serialized threads `numbers` name, for cross-reference `source` objects. */
export async function serializeThreadsByNumber(
	repo: RepositoryRowWithOwner,
	numbers: number[],
): Promise<Map<number, unknown>> {
	const unique = [...new Set(numbers)];
	const rows = await findThreadRowsByNumber(repo.id, unique);
	const meta = await loadThreadMeta(repo.id, rows);
	return new Map(
		rows.map((row) => [row.number, serializeThread(repo, row, meta)]),
	);
}
