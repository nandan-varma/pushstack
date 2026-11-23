/**
 * Projects v2: user-owned projects, their fields and single-select options,
 * and the issues, pull requests or drafts on them. Plain server-only module
 * shared by the GraphQL API and the web server functions; every read applies
 * access here, and every write requires the project's owner.
 *
 * A public project is readable, but its items are readable only as far as the
 * repository holding each item is readable (`repo-access.ts`), so an
 * unreadable issue or pull request is omitted rather than merely hidden.
 * Neon's HTTP driver has no interactive transactions, so a create that fans
 * out to several rows cleans up what it wrote when a later step fails.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
	issues,
	organizations,
	projectV2,
	projectV2Fields,
	projectV2ItemFieldValues,
	projectV2Items,
	projectV2SingleSelectOptions,
	repositories,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	MAX_BODY_CHARS,
	MAX_PROJECT_DESCRIPTION_CHARS,
	MAX_PROJECT_FIELD_NAME_CHARS,
	MAX_PROJECT_FIELDS,
	MAX_PROJECT_FILTER_CHARS,
	MAX_PROJECT_ITEMS,
	MAX_PROJECT_OPTION_NAME_CHARS,
	MAX_PROJECT_SINGLE_SELECT_OPTIONS,
	MAX_PROJECT_TEXT_VALUE_CHARS,
	MAX_PROJECT_TITLE_CHARS,
	MAX_PROJECTS_PER_USER,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { parseProjectFilter } from "#/lib/project-filter";
import { isUniqueViolation } from "./db-errors";
import { containing } from "./db-filters";
import { withLockKey } from "./git-repo-lock";
import { canReadRepo, readableForViewer } from "./repo-access";

/**
 * A Projects v2 write GitHub refuses (a cap, a duplicate name, a value of the
 * wrong type, an unreadable item). The GraphQL layer answers it as
 * UNPROCESSABLE; `status` is the REST-shaped code for callers that use one.
 */
export class ProjectValidationError extends Error {
	readonly status = 422;
}

export type ProjectView = typeof projectV2.$inferSelect;
export type ProjectFieldView = typeof projectV2Fields.$inferSelect;
export type ProjectOptionView =
	typeof projectV2SingleSelectOptions.$inferSelect;
export type ProjectItemView = typeof projectV2Items.$inferSelect;
export type ProjectFieldValueView =
	typeof projectV2ItemFieldValues.$inferSelect;
export type ProjectFieldDataType = ProjectFieldView["dataType"];

/** An item and the repository its content belongs to (null for a draft). */
export interface ProjectItemWithRepo extends ProjectItemView {
	repoId: number | null;
}

/** A value with the field it belongs to, as GitHub returns both. */
export interface ProjectItemFieldValue {
	value: ProjectFieldValueView;
	field: ProjectFieldView;
}

export interface ProjectAccess {
	canRead: boolean;
	canWrite: boolean;
}

export const PROJECT_FIELD_TYPES: readonly ProjectFieldDataType[] = [
	"TEXT",
	"NUMBER",
	"DATE",
	"SINGLE_SELECT",
];

/** GitHub's built-in Status field and its three options. */
const STATUS_FIELD = "Status";
const STATUS_OPTIONS = [
	{ name: "Todo", color: "GRAY" },
	{ name: "In Progress", color: "YELLOW" },
	{ name: "Done", color: "GREEN" },
] as const;

/**
 * A single-select option's GraphQL `id` is an opaque stable string. The row id
 * is stable and clients never interpret it; `optionRowId` accepts it back.
 */
export function optionIdOf(option: { id: number }): string {
	return String(option.id);
}

export function optionRowId(optionId: string): number | null {
	return /^\d{1,10}$/.test(optionId) ? Number(optionId) : null;
}

/** What the viewer may do with a project: the owner writes, anyone reads a public one. */
export function projectAccess(
	project: Pick<ProjectView, "ownerId" | "public">,
	viewerId: string | null | undefined,
): ProjectAccess {
	const owner = viewerId != null && viewerId === project.ownerId;
	return { canRead: owner || project.public, canWrite: owner };
}

/** A closed project is read-only: GitHub keeps every write behind a reopen. */
function assertWritable(
	project: Pick<ProjectView, "ownerId" | "public" | "closed">,
	viewerId: string,
): void {
	if (!projectAccess(project, viewerId).canWrite)
		throw new ProjectValidationError("The project is not writable");
	if (project.closed) throw new ProjectValidationError("The project is closed");
}

function assertLength(value: string, max: number, message: string): void {
	if (value.length > max) throw new ProjectValidationError(message);
}

const projectColumns = {
	id: projectV2.id,
	ownerId: projectV2.ownerId,
	number: projectV2.number,
	title: projectV2.title,
	shortDescription: projectV2.shortDescription,
	readme: projectV2.readme,
	public: projectV2.public,
	closed: projectV2.closed,
	createdAt: projectV2.createdAt,
	updatedAt: projectV2.updatedAt,
	closedAt: projectV2.closedAt,
};

/**
 * Claim the next project number for an owner with one atomic UPDATE …
 * RETURNING, so concurrent creates never share a number.
 */
export async function claimProjectNumber(ownerId: string): Promise<number> {
	const [row] = await db
		.update(user)
		.set({ nextProjectNumber: sql`${user.nextProjectNumber} + 1` })
		.where(eq(user.id, ownerId))
		.returning({ next: user.nextProjectNumber });
	if (!row) throw new Error("User not found");
	return row.next - 1;
}

const projectVisibility = (
	viewerId: string | null | undefined,
): SQL | undefined =>
	viewerId
		? or(eq(projectV2.public, true), eq(projectV2.ownerId, viewerId))
		: eq(projectV2.public, true);

export async function countProjects(ownerId: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(projectV2)
		.where(eq(projectV2.ownerId, ownerId));
	return Number(row?.total ?? 0);
}

function touchProject(projectId: number): Promise<unknown> {
	return db
		.update(projectV2)
		.set({ updatedAt: new Date() })
		.where(eq(projectV2.id, projectId));
}

export interface CreateProjectInput {
	title: string;
	shortDescription?: string | null;
	readme?: string | null;
	public?: boolean;
}

/**
 * Create a project and its built-in Status field (Todo / In Progress / Done).
 * The count-then-insert cap check runs under the owner's lease, and a failure
 * after the project row exists drops it (cascading to the field) so a retry
 * does not leave a nameless project behind.
 */
export async function createProjectForUser(
	ownerId: string,
	input: CreateProjectInput,
): Promise<ProjectView> {
	const title = input.title.trim();
	if (!title) throw new ProjectValidationError("A project needs a title");
	assertLength(
		title,
		MAX_PROJECT_TITLE_CHARS,
		`A project title is at most ${MAX_PROJECT_TITLE_CHARS} characters`,
	);
	const description = input.shortDescription?.trim() || null;
	if (description !== null)
		assertLength(
			description,
			MAX_PROJECT_DESCRIPTION_CHARS,
			`A project description is at most ${MAX_PROJECT_DESCRIPTION_CHARS} characters`,
		);
	const readme = input.readme || null;
	return withLockKey(`caps/projects/${ownerId}`, async () => {
		if ((await countProjects(ownerId)) >= MAX_PROJECTS_PER_USER) {
			throw new ProjectValidationError(
				`A user holds at most ${MAX_PROJECTS_PER_USER} projects`,
			);
		}
		const number = await claimProjectNumber(ownerId);
		const [project] = await db
			.insert(projectV2)
			.values({
				ownerId,
				number,
				title,
				shortDescription: description,
				readme,
				public: input.public ?? false,
			})
			.returning();
		if (!project) throw new Error("Project insert returned no row");
		try {
			await insertField(project.id, {
				name: STATUS_FIELD,
				dataType: "SINGLE_SELECT",
				options: STATUS_OPTIONS,
			});
		} catch (error) {
			await db.delete(projectV2).where(eq(projectV2.id, project.id));
			throw error;
		}
		return project;
	});
}

/** A project by its owner and per-owner number, ignoring the viewer. */
export async function findProjectByNumber(
	ownerId: string,
	number: number,
): Promise<ProjectView | null> {
	const [row] = await db
		.select(projectColumns)
		.from(projectV2)
		.where(and(eq(projectV2.ownerId, ownerId), eq(projectV2.number, number)));
	return row ?? null;
}

/** A project by owner login and number, only when the viewer may read it. */
export async function findProjectByOwnerAndNumber(
	ownerUsername: string,
	number: number,
	viewerId: string | null | undefined,
): Promise<ProjectView | null> {
	const [row] = await db
		.select(projectColumns)
		.from(projectV2)
		.innerJoin(user, eq(projectV2.ownerId, user.id))
		.where(
			and(
				eq(user.username, ownerUsername),
				eq(projectV2.number, number),
				projectVisibility(viewerId),
			),
		);
	return row ?? null;
}

/** The user a login names, for the web project routes. */
export async function findProjectOwner(
	login: string,
): Promise<{ id: string; username: string } | null> {
	const [row] = await db
		.select({ id: user.id, username: user.username })
		.from(user)
		.where(eq(user.username, login));
	return row ?? null;
}

/** A project by row id, only when the viewer may read it. */
export async function findReadableProjectById(
	projectId: number,
	viewerId: string | null | undefined,
): Promise<ProjectView | null> {
	const [row] = await db
		.select(projectColumns)
		.from(projectV2)
		.where(and(eq(projectV2.id, projectId), projectVisibility(viewerId)));
	return row ?? null;
}

/** A project by row id, for a write the caller has already been checked for. */
export async function findProjectById(
	projectId: number,
): Promise<ProjectView | null> {
	const [row] = await db
		.select(projectColumns)
		.from(projectV2)
		.where(eq(projectV2.id, projectId));
	return row ?? null;
}

export interface ProjectOrder {
	field: "CREATED_AT" | "NUMBER" | "TITLE" | "UPDATED_AT";
	direction: "ASC" | "DESC";
}

const PROJECT_ORDER = {
	CREATED_AT: projectV2.createdAt,
	NUMBER: projectV2.number,
	TITLE: projectV2.title,
	UPDATED_AT: projectV2.updatedAt,
} as const;

function projectOrderBy(orderBy?: ProjectOrder | null) {
	const order = orderBy ?? { field: "NUMBER", direction: "DESC" };
	const column = PROJECT_ORDER[order.field];
	const direction = order.direction === "ASC" ? asc : desc;
	return [direction(column), direction(projectV2.id)];
}

export interface ProjectListOptions {
	query?: string | null;
	orderBy?: ProjectOrder | null;
	offset: number;
	limit: number;
}

/** An owner's projects the viewer may read, newest-number first by default. */
export async function listProjectsForOwner(
	ownerId: string,
	viewerId: string | null | undefined,
	options: ProjectListOptions,
): Promise<{ projects: ProjectView[]; total: number }> {
	const search = options.query?.trim() ?? "";
	assertLength(
		search,
		MAX_PROJECT_FILTER_CHARS,
		`A project search is at most ${MAX_PROJECT_FILTER_CHARS} characters`,
	);
	const where = and(
		eq(projectV2.ownerId, ownerId),
		projectVisibility(viewerId),
		search ? projectSearch(search) : undefined,
	);
	const [projects, [held]] = await Promise.all([
		db
			.select(projectColumns)
			.from(projectV2)
			.where(where)
			.orderBy(...projectOrderBy(options.orderBy))
			.limit(options.limit)
			.offset(options.offset),
		db.select({ total: count() }).from(projectV2).where(where),
	]);
	return { projects, total: Number(held?.total ?? 0) };
}

function projectSearch(search: string): SQL | undefined {
	const pattern = containing(search);
	return or(
		ilike(projectV2.title, pattern),
		ilike(projectV2.shortDescription, pattern),
	);
}

/**
 * Projects linked to a repository (it holds one of their items), readable by
 * the viewer. A project owned by someone else is listed only when public.
 */
export async function listProjectsForRepository(
	repoId: number,
	viewerId: string | null | undefined,
	options: ProjectListOptions,
): Promise<{
	projects: (ProjectView & { ownerLogin: string })[];
	total: number;
}> {
	const search = options.query?.trim() ?? "";
	assertLength(
		search,
		MAX_PROJECT_FILTER_CHARS,
		`A project search is at most ${MAX_PROJECT_FILTER_CHARS} characters`,
	);
	const where = and(
		projectVisibility(viewerId),
		search ? projectSearch(search) : undefined,
		exists(
			db
				.select({ one: sql`1` })
				.from(projectV2Items)
				.innerJoin(issues, eq(issues.id, projectV2Items.issueId))
				.where(
					and(
						eq(projectV2Items.projectId, projectV2.id),
						eq(issues.repoId, repoId),
					),
				),
		),
	);
	const [rows, [held]] = await Promise.all([
		db
			.select({ ...projectColumns, ownerLogin: user.username })
			.from(projectV2)
			.innerJoin(user, eq(user.id, projectV2.ownerId))
			.where(where)
			.orderBy(...projectOrderBy(options.orderBy))
			.limit(options.limit)
			.offset(options.offset),
		db.select({ total: count() }).from(projectV2).where(where),
	]);
	return { projects: rows, total: Number(held?.total ?? 0) };
}

export async function closeProject(
	projectId: number,
	viewerId: string,
	closed: boolean,
): Promise<ProjectView | null> {
	const project = await findProjectById(projectId);
	if (!project || !projectAccess(project, viewerId).canWrite) return null;
	const [row] = await db
		.update(projectV2)
		.set({
			closed,
			closedAt: closed ? new Date() : null,
			updatedAt: new Date(),
		})
		.where(eq(projectV2.id, projectId))
		.returning();
	return row ?? null;
}

const fieldColumns = {
	id: projectV2Fields.id,
	projectId: projectV2Fields.projectId,
	name: projectV2Fields.name,
	dataType: projectV2Fields.dataType,
	position: projectV2Fields.position,
	createdAt: projectV2Fields.createdAt,
	updatedAt: projectV2Fields.updatedAt,
};

const optionColumns = {
	id: projectV2SingleSelectOptions.id,
	fieldId: projectV2SingleSelectOptions.fieldId,
	name: projectV2SingleSelectOptions.name,
	color: projectV2SingleSelectOptions.color,
	position: projectV2SingleSelectOptions.position,
};

export async function listProjectFields(
	projectId: number,
	page: { offset: number; limit: number },
): Promise<{ fields: ProjectFieldView[]; total: number }> {
	const where = eq(projectV2Fields.projectId, projectId);
	const [fields, [held]] = await Promise.all([
		db
			.select(fieldColumns)
			.from(projectV2Fields)
			.where(where)
			.orderBy(asc(projectV2Fields.position), asc(projectV2Fields.id))
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(projectV2Fields).where(where),
	]);
	return { fields, total: Number(held?.total ?? 0) };
}

export function countProjectFields(projectId: number): Promise<number> {
	return db
		.select({ total: count() })
		.from(projectV2Fields)
		.where(eq(projectV2Fields.projectId, projectId))
		.then(([row]) => Number(row?.total ?? 0));
}

export function listFieldOptions(
	fieldId: number,
): Promise<ProjectOptionView[]> {
	return db
		.select(optionColumns)
		.from(projectV2SingleSelectOptions)
		.where(eq(projectV2SingleSelectOptions.fieldId, fieldId))
		.orderBy(
			asc(projectV2SingleSelectOptions.position),
			asc(projectV2SingleSelectOptions.id),
		);
}

/** Every single-select option of a project's fields, in field then option order. */
export function listProjectFieldOptions(
	projectId: number,
): Promise<ProjectOptionView[]> {
	return db
		.select(optionColumns)
		.from(projectV2SingleSelectOptions)
		.innerJoin(
			projectV2Fields,
			eq(projectV2Fields.id, projectV2SingleSelectOptions.fieldId),
		)
		.where(eq(projectV2Fields.projectId, projectId))
		.orderBy(
			asc(projectV2Fields.position),
			asc(projectV2SingleSelectOptions.position),
			asc(projectV2SingleSelectOptions.id),
		);
}

export async function findProjectField(
	fieldId: number,
): Promise<ProjectFieldView | null> {
	const [row] = await db
		.select(fieldColumns)
		.from(projectV2Fields)
		.where(eq(projectV2Fields.id, fieldId));
	return row ?? null;
}

export interface ProjectFieldInput {
	name: string;
	dataType: ProjectFieldDataType;
	options?: ReadonlyArray<{ name: string; color?: string }>;
}

function checkedOptions(
	input: ProjectFieldInput,
): ReadonlyArray<{ name: string; color: string }> {
	const options = input.options ?? [];
	if (input.dataType !== "SINGLE_SELECT") {
		if (options.length > 0)
			throw new ProjectValidationError(
				"Only a single-select field takes options",
			);
		return [];
	}
	if (options.length === 0)
		throw new ProjectValidationError(
			"A single-select field needs at least one option",
		);
	if (options.length > MAX_PROJECT_SINGLE_SELECT_OPTIONS)
		throw new ProjectValidationError(
			`A single-select field holds at most ${MAX_PROJECT_SINGLE_SELECT_OPTIONS} options`,
		);
	const seen = new Set<string>();
	return options.map((option) => {
		const name = option.name.trim();
		if (!name)
			throw new ProjectValidationError("A single-select option needs a name");
		assertLength(
			name,
			MAX_PROJECT_OPTION_NAME_CHARS,
			`An option name is at most ${MAX_PROJECT_OPTION_NAME_CHARS} characters`,
		);
		const key = name.toLowerCase();
		if (seen.has(key))
			throw new ProjectValidationError(`Duplicate option name: ${name}`);
		seen.add(key);
		return { name, color: option.color ?? "GRAY" };
	});
}

async function insertField(
	projectId: number,
	input: ProjectFieldInput,
): Promise<ProjectFieldView> {
	const name = input.name.trim();
	if (!name) throw new ProjectValidationError("A field needs a name");
	assertLength(
		name,
		MAX_PROJECT_FIELD_NAME_CHARS,
		`A field name is at most ${MAX_PROJECT_FIELD_NAME_CHARS} characters`,
	);
	const options = checkedOptions(input);
	const [last] = await db
		.select({ position: projectV2Fields.position })
		.from(projectV2Fields)
		.where(eq(projectV2Fields.projectId, projectId))
		.orderBy(desc(projectV2Fields.position))
		.limit(1);
	const [field] = await db
		.insert(projectV2Fields)
		.values({
			projectId,
			name,
			dataType: input.dataType,
			position: (last?.position ?? -1) + 1,
		})
		.returning()
		.catch((error: unknown) => {
			throw isUniqueViolation(error)
				? new ProjectValidationError(`A field named ${name} already exists`)
				: error;
		});
	if (!field) throw new Error("Field insert returned no row");
	if (options.length > 0) {
		try {
			await db.insert(projectV2SingleSelectOptions).values(
				options.map((option, position) => ({
					fieldId: field.id,
					name: option.name,
					color: option.color,
					position,
				})),
			);
		} catch (error) {
			await db.delete(projectV2Fields).where(eq(projectV2Fields.id, field.id));
			throw isUniqueViolation(error)
				? new ProjectValidationError("Duplicate option name")
				: error;
		}
	}
	return field;
}

/** Create a field on a project the viewer owns and that is not closed. */
export async function createProjectField(
	projectId: number,
	viewerId: string,
	input: ProjectFieldInput,
): Promise<ProjectFieldView> {
	const project = await findProjectById(projectId);
	if (!project || !projectAccess(project, viewerId).canWrite)
		throw new ProjectValidationError("The project is not writable");
	assertWritable(project, viewerId);
	if ((await countProjectFields(projectId)) >= MAX_PROJECT_FIELDS)
		throw new ProjectValidationError(
			`A project holds at most ${MAX_PROJECT_FIELDS} fields`,
		);
	const field = await insertField(projectId, input);
	await touchProject(projectId);
	return field;
}

/**
 * Rename a field, and for a single-select one replace its options. An option
 * named by id keeps its row, so values already set on it survive.
 */
export async function updateProjectField(
	fieldId: number,
	viewerId: string,
	input: {
		name?: string;
		options?: ReadonlyArray<{ id?: string; name: string; color?: string }>;
	},
): Promise<ProjectFieldView | null> {
	const field = await findProjectField(fieldId);
	if (!field) return null;
	const project = await findProjectById(field.projectId);
	if (!project || !projectAccess(project, viewerId).canWrite) return null;
	assertWritable(project, viewerId);
	const changes: { name?: string; updatedAt: Date } = { updatedAt: new Date() };
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new ProjectValidationError("A field needs a name");
		assertLength(
			name,
			MAX_PROJECT_FIELD_NAME_CHARS,
			`A field name is at most ${MAX_PROJECT_FIELD_NAME_CHARS} characters`,
		);
		changes.name = name;
	}
	const [updated] = await db
		.update(projectV2Fields)
		.set(changes)
		.where(eq(projectV2Fields.id, fieldId))
		.returning()
		.catch((error: unknown) => {
			throw isUniqueViolation(error)
				? new ProjectValidationError("A field with this name already exists")
				: error;
		});
	if (!updated) return null;
	if (input.options !== undefined) {
		if (field.dataType !== "SINGLE_SELECT")
			throw new ProjectValidationError(
				"Only a single-select field takes options",
			);
		await replaceOptions(fieldId, input.options);
	}
	await touchProject(field.projectId);
	return updated;
}

async function replaceOptions(
	fieldId: number,
	input: ReadonlyArray<{ id?: string; name: string; color?: string }>,
): Promise<void> {
	if (input.length === 0)
		throw new ProjectValidationError(
			"A single-select field needs at least one option",
		);
	if (input.length > MAX_PROJECT_SINGLE_SELECT_OPTIONS)
		throw new ProjectValidationError(
			`A single-select field holds at most ${MAX_PROJECT_SINGLE_SELECT_OPTIONS} options`,
		);
	const existing = await listFieldOptions(fieldId);
	const byId = new Map(existing.map((option) => [String(option.id), option]));
	const kept = new Set<number>();
	const seen = new Set<string>();
	interface OptionUpdate {
		id: number;
		fieldId: number;
		name: string;
		color: string;
		position: number;
	}
	interface OptionInsert {
		fieldId: number;
		name: string;
		color: string;
		position: number;
	}
	const rows: (OptionUpdate | OptionInsert)[] = input.map(
		(option, position) => {
			const name = option.name.trim();
			if (!name)
				throw new ProjectValidationError("A single-select option needs a name");
			assertLength(
				name,
				MAX_PROJECT_OPTION_NAME_CHARS,
				`An option name is at most ${MAX_PROJECT_OPTION_NAME_CHARS} characters`,
			);
			const key = name.toLowerCase();
			if (seen.has(key))
				throw new ProjectValidationError(`Duplicate option name: ${name}`);
			seen.add(key);
			const id = option.id === undefined ? null : optionRowId(option.id);
			const current = id === null ? undefined : byId.get(String(id));
			if (current && id !== null) {
				kept.add(id);
				return {
					id,
					fieldId,
					name,
					color: option.color ?? current.color,
					position,
				};
			}
			return { fieldId, name, color: option.color ?? "GRAY", position };
		},
	);
	const removed = existing
		.filter((option) => !kept.has(option.id))
		.map((option) => option.id);
	const updated = rows.filter((row): row is OptionUpdate => "id" in row);
	const created = rows.filter((row): row is OptionInsert => !("id" in row));
	try {
		if (removed.length > 0)
			await db
				.delete(projectV2SingleSelectOptions)
				.where(inArray(projectV2SingleSelectOptions.id, removed));
		for (const row of updated) {
			await db
				.update(projectV2SingleSelectOptions)
				.set({ name: row.name, color: row.color, position: row.position })
				.where(eq(projectV2SingleSelectOptions.id, row.id));
		}
		if (created.length > 0)
			await db.insert(projectV2SingleSelectOptions).values(created);
	} catch (error) {
		throw isUniqueViolation(error)
			? new ProjectValidationError("Duplicate option name")
			: error;
	}
}

export type ProjectItemContentInput =
	| { issueId: number }
	| { draftTitle: string; draftBody?: string | null };

export interface ProjectItemsOptions {
	query?: string | null;
	archivedStates?: readonly ("ARCHIVED" | "NOT_ARCHIVED")[];
	offset: number;
	limit: number;
}

/** Items the viewer may see: drafts on a readable project, issues only when their repository is readable. */
function visibleItemCondition(
	viewerId: string | null | undefined,
): SQL | undefined {
	return or(isNull(projectV2Items.issueId), readableForViewer(viewerId));
}

function itemTitle() {
	return sql<string>`coalesce(${projectV2Items.draftTitle}, ${issues.title}, '')`;
}

/** Display values share the web/GraphQL filter's case-insensitive field names. */
function itemFieldDisplay(name: string) {
	return sql<string>`coalesce((select case ${projectV2Fields.dataType}
		when 'TEXT' then ${projectV2ItemFieldValues.valueText}
		when 'NUMBER' then cast(${projectV2ItemFieldValues.valueNumber} as text)
		when 'DATE' then cast(${projectV2ItemFieldValues.valueDate} as text)
		when 'SINGLE_SELECT' then ${projectV2SingleSelectOptions.name}
		end
		from ${projectV2ItemFieldValues}
		inner join ${projectV2Fields} on ${projectV2Fields.id} = ${projectV2ItemFieldValues.fieldId}
		left join ${projectV2SingleSelectOptions} on ${projectV2SingleSelectOptions.id} = ${projectV2ItemFieldValues.optionId}
		where ${projectV2ItemFieldValues.itemId} = ${projectV2Items.id}
		and lower(${projectV2Fields.name}) = ${name}
		limit 1), '')`;
}

function itemSearch(search: string): SQL | undefined {
	const filter = parseProjectFilter(search);
	const conditions: SQL[] = filter.terms.map((term) =>
		ilike(itemTitle(), containing(term)),
	);
	if (filter.kinds.length) {
		conditions.push(sql`(case when ${projectV2Items.issueId} is null then 'draft'
			when ${issues.kind} = 'pull_request' then 'pull_request' else 'issue' end)
			in (${sql.join(
				filter.kinds.map((kind) => sql`${kind}`),
				sql`, `,
			)})`);
	}
	for (const { field, value } of filter.values) {
		conditions.push(eq(sql`lower(${itemFieldDisplay(field)})`, value));
	}
	for (const field of filter.empty)
		conditions.push(eq(itemFieldDisplay(field), ""));
	return conditions.length ? and(...conditions) : undefined;
}

function itemsWhere(
	projectId: number,
	viewerId: string | null | undefined,
	options: ProjectItemsOptions,
): SQL | undefined {
	const search = options.query?.trim() ?? "";
	assertLength(
		search,
		MAX_PROJECT_FILTER_CHARS,
		`An item search is at most ${MAX_PROJECT_FILTER_CHARS} characters`,
	);
	const states = options.archivedStates ?? ["NOT_ARCHIVED"];
	const archived =
		states.length === 1
			? eq(projectV2Items.archived, states[0] === "ARCHIVED")
			: undefined;
	return and(
		eq(projectV2Items.projectId, projectId),
		visibleItemCondition(viewerId),
		archived,
		search ? itemSearch(search) : undefined,
	);
}

function itemSelection() {
	return {
		id: projectV2Items.id,
		projectId: projectV2Items.projectId,
		issueId: projectV2Items.issueId,
		draftTitle: projectV2Items.draftTitle,
		draftBody: projectV2Items.draftBody,
		archived: projectV2Items.archived,
		createdAt: projectV2Items.createdAt,
		updatedAt: projectV2Items.updatedAt,
		repoId: issues.repoId,
	};
}

/** One page of a project's readable items, oldest first (GitHub's item position). */
export async function listProjectItems(
	projectId: number,
	viewerId: string | null | undefined,
	options: ProjectItemsOptions,
): Promise<{ items: ProjectItemWithRepo[]; total: number }> {
	const where = itemsWhere(projectId, viewerId, options);
	const [items, [held]] = await Promise.all([
		db
			.select(itemSelection())
			.from(projectV2Items)
			.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
			.leftJoin(repositories, eq(repositories.id, issues.repoId))
			.where(where)
			.orderBy(asc(projectV2Items.createdAt), asc(projectV2Items.id))
			.limit(options.limit)
			.offset(options.offset),
		db
			.select({ total: count() })
			.from(projectV2Items)
			.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
			.leftJoin(repositories, eq(repositories.id, issues.repoId))
			.where(where),
	]);
	return { items, total: Number(held?.total ?? 0) };
}

/**
 * A project item by row id, only when the project and (for an issue or pull
 * request) its repository are readable. An archived item is still readable.
 */
export async function findReadableProjectItem(
	itemId: number,
	viewerId: string | null | undefined,
): Promise<ProjectItemWithRepo | null> {
	const [row] = await db
		.select({
			...itemSelection(),
			public: projectV2.public,
			ownerId: projectV2.ownerId,
		})
		.from(projectV2Items)
		.innerJoin(projectV2, eq(projectV2.id, projectV2Items.projectId))
		.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
		.leftJoin(repositories, eq(repositories.id, issues.repoId))
		.where(
			and(
				eq(projectV2Items.id, itemId),
				projectVisibility(viewerId),
				visibleItemCondition(viewerId),
			),
		);
	if (!row) return null;
	const { public: isPublic, ownerId, ...item } = row;
	return projectAccess({ ownerId, public: isPublic }, viewerId).canRead
		? item
		: null;
}

/** Items that link one issue or pull request, across the projects the viewer may read. */
export async function listProjectItemsForThread(
	issueId: number,
	viewerId: string | null | undefined,
	page: { offset: number; limit: number },
	includeArchived = true,
): Promise<{ items: ProjectItemWithRepo[]; total: number }> {
	const where = and(
		eq(projectV2Items.issueId, issueId),
		includeArchived ? undefined : eq(projectV2Items.archived, false),
		projectVisibility(viewerId),
	);
	const [items, [held]] = await Promise.all([
		db
			.select({ ...itemSelection(), issuesRepoId: issues.repoId })
			.from(projectV2Items)
			.innerJoin(projectV2, eq(projectV2.id, projectV2Items.projectId))
			.innerJoin(issues, eq(issues.id, projectV2Items.issueId))
			.where(where)
			.orderBy(asc(projectV2Items.createdAt), asc(projectV2Items.id))
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(projectV2Items)
			.innerJoin(projectV2, eq(projectV2.id, projectV2Items.projectId))
			.where(where),
	]);
	return {
		items: items.map(({ issuesRepoId: _, ...item }) => item),
		total: Number(held?.total ?? 0),
	};
}

async function countProjectItems(projectId: number): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(projectV2Items)
		.where(eq(projectV2Items.projectId, projectId));
	return Number(row?.total ?? 0);
}

/**
 * Add an issue, pull request or draft to a project. A duplicate issue and a
 * content the viewer cannot read are refused; the caller must own the project.
 */
export async function addProjectItem(
	projectId: number,
	viewerId: string,
	content: ProjectItemContentInput,
): Promise<ProjectItemView> {
	const project = await findProjectById(projectId);
	if (!project || !projectAccess(project, viewerId).canWrite)
		throw new ProjectValidationError("The project is not writable");
	assertWritable(project, viewerId);
	if ((await countProjectItems(projectId)) >= MAX_PROJECT_ITEMS)
		throw new ProjectValidationError(
			`A project holds at most ${MAX_PROJECT_ITEMS} items`,
		);
	let values: typeof projectV2Items.$inferInsert;
	if ("issueId" in content) {
		const [issue] = await db
			.select({ repoId: issues.repoId })
			.from(issues)
			.where(eq(issues.id, content.issueId));
		if (!issue)
			throw new ProjectValidationError("Unknown issue or pull request");
		if (!(await canReadRepo(issue.repoId, viewerId)))
			throw new ProjectValidationError("Unknown issue or pull request");
		values = { projectId, issueId: content.issueId };
	} else {
		const title = content.draftTitle.trim();
		if (!title) throw new ProjectValidationError("A draft needs a title");
		assertLength(
			title,
			MAX_THREAD_TITLE_CHARS,
			`A draft title is at most ${MAX_THREAD_TITLE_CHARS} characters`,
		);
		const body = content.draftBody || null;
		if (body !== null)
			assertLength(
				body,
				MAX_BODY_CHARS,
				`A draft body is at most ${MAX_BODY_CHARS} characters`,
			);
		values = { projectId, draftTitle: title, draftBody: body };
	}
	const [item] = await db
		.insert(projectV2Items)
		.values(values)
		.returning()
		.catch((error: unknown) => {
			throw isUniqueViolation(error)
				? new ProjectValidationError("The item is already in the project")
				: error;
		});
	if (!item) throw new Error("Item insert returned no row");
	await touchProject(projectId);
	return item;
}

/** Replace a draft's title and body; issue and pull request items have neither. */
export async function updateProjectDraftIssue(
	itemId: number,
	viewerId: string,
	input: { title: string; body?: string | null },
): Promise<ProjectItemView | null> {
	const item = await findProjectItemForWrite(itemId, viewerId);
	if (!item || item.issueId !== null) return null;
	const title = input.title.trim();
	if (!title) throw new ProjectValidationError("A draft needs a title");
	assertLength(
		title,
		MAX_THREAD_TITLE_CHARS,
		`A draft title is at most ${MAX_THREAD_TITLE_CHARS} characters`,
	);
	const body = input.body === undefined ? item.draftBody : input.body;
	if (body !== null)
		assertLength(
			body,
			MAX_BODY_CHARS,
			`A draft body is at most ${MAX_BODY_CHARS} characters`,
		);
	const [row] = await db
		.update(projectV2Items)
		.set({ draftTitle: title, draftBody: body, updatedAt: new Date() })
		.where(eq(projectV2Items.id, itemId))
		.returning();
	await touchProject(item.projectId);
	return row ?? null;
}

async function findProjectItemForWrite(
	itemId: number,
	viewerId: string,
): Promise<ProjectItemView | null> {
	const [row] = await db
		.select({
			item: projectV2Items,
			ownerId: projectV2.ownerId,
			public: projectV2.public,
			closed: projectV2.closed,
		})
		.from(projectV2Items)
		.innerJoin(projectV2, eq(projectV2.id, projectV2Items.projectId))
		.where(eq(projectV2Items.id, itemId));
	if (!row) return null;
	assertWritable(
		{ ownerId: row.ownerId, public: row.public, closed: row.closed },
		viewerId,
	);
	return row.item;
}

export type ProjectFieldValueInput =
	| { type: "TEXT"; text: string }
	| { type: "NUMBER"; number: number }
	| { type: "DATE"; date: string }
	| { type: "SINGLE_SELECT"; optionId: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function checkedDate(date: string): string {
	const match = DATE_RE.exec(date);
	const parsed = match ? new Date(`${date}T00:00:00Z`) : null;
	if (!match || !parsed || Number.isNaN(parsed.getTime()))
		throw new ProjectValidationError(`Invalid date: ${date}`);
	if (parsed.toISOString().slice(0, 10) !== date)
		throw new ProjectValidationError(`Invalid date: ${date}`);
	return date;
}

/** The value columns for `input`, refusing a value that does not match the field's type. */
async function fieldValueColumns(
	field: ProjectFieldView,
	input: ProjectFieldValueInput,
): Promise<
	Pick<
		typeof projectV2ItemFieldValues.$inferInsert,
		"valueText" | "valueNumber" | "valueDate" | "optionId"
	>
> {
	if (field.dataType !== input.type)
		throw new ProjectValidationError(
			`Field ${field.name} takes a ${field.dataType} value`,
		);
	switch (input.type) {
		case "TEXT":
			assertLength(
				input.text,
				MAX_PROJECT_TEXT_VALUE_CHARS,
				`A text value is at most ${MAX_PROJECT_TEXT_VALUE_CHARS} characters`,
			);
			return { valueText: input.text };
		case "NUMBER":
			if (!Number.isFinite(input.number))
				throw new ProjectValidationError("A number value must be finite");
			return { valueNumber: input.number };
		case "DATE":
			return { valueDate: checkedDate(input.date) };
		case "SINGLE_SELECT": {
			const id = optionRowId(input.optionId);
			const [option] = id
				? await db
						.select({ fieldId: projectV2SingleSelectOptions.fieldId })
						.from(projectV2SingleSelectOptions)
						.where(eq(projectV2SingleSelectOptions.id, id))
				: [];
			if (!option || option.fieldId !== field.id)
				throw new ProjectValidationError(
					`Unknown option for field ${field.name}`,
				);
			return { optionId: id };
		}
	}
}

/** Set (or replace) one value on an item; the field must belong to the item's project. */
export async function setProjectItemFieldValue(
	itemId: number,
	viewerId: string,
	fieldId: number,
	input: ProjectFieldValueInput,
): Promise<ProjectItemFieldValue | null> {
	const item = await findProjectItemForWrite(itemId, viewerId);
	if (!item) return null;
	const field = await findProjectField(fieldId);
	if (!field || field.projectId !== item.projectId) return null;
	const columns = await fieldValueColumns(field, input);
	const [value] = await db
		.insert(projectV2ItemFieldValues)
		.values({ itemId, fieldId, ...columns })
		.onConflictDoUpdate({
			target: [
				projectV2ItemFieldValues.itemId,
				projectV2ItemFieldValues.fieldId,
			],
			set: { ...columns, updatedAt: new Date() },
		})
		.returning();
	if (!value) throw new Error("Field value insert returned no row");
	await touchProject(item.projectId);
	return { value, field };
}

export async function clearProjectItemFieldValue(
	itemId: number,
	viewerId: string,
	fieldId: number,
): Promise<boolean> {
	const item = await findProjectItemForWrite(itemId, viewerId);
	if (!item) return false;
	const deleted = await db
		.delete(projectV2ItemFieldValues)
		.where(
			and(
				eq(projectV2ItemFieldValues.itemId, itemId),
				eq(projectV2ItemFieldValues.fieldId, fieldId),
			),
		)
		.returning({ id: projectV2ItemFieldValues.id });
	if (deleted.length > 0) await touchProject(item.projectId);
	return deleted.length > 0;
}

export interface ProjectBoardItem extends ProjectItemWithRepo {
	contentTitle: string | null;
	contentNumber: number | null;
	contentKind: "issue" | "pull_request" | "discussion" | null;
	repoOwner: string | null;
	repoName: string | null;
}

/**
 * A page of a project's readable items with their content and repository, for
 * the web table. The same visibility rule as `listProjectItems`, one query.
 */
export async function listProjectBoardItems(
	projectId: number,
	viewerId: string | null | undefined,
	page: {
		offset: number;
		limit: number;
		query?: string;
		sort?: string;
		dir?: "asc" | "desc";
	},
): Promise<{ items: ProjectBoardItem[]; total: number; itemCount: number }> {
	const where = itemsWhere(projectId, viewerId, {
		offset: page.offset,
		limit: page.limit,
		query: page.query,
	});
	const allWhere = itemsWhere(projectId, viewerId, {
		offset: 0,
		limit: page.limit,
	});
	const order = page.dir === "desc" ? desc : asc;
	let sortColumn:
		| SQL
		| typeof projectV2Items.updatedAt
		| typeof projectV2Items.createdAt = projectV2Items.createdAt;
	if (page.sort === "title") sortColumn = itemTitle();
	else if (page.sort === "updated") sortColumn = projectV2Items.updatedAt;
	else if (page.sort) {
		const [field] = await db
			.select({ id: projectV2Fields.id, dataType: projectV2Fields.dataType })
			.from(projectV2Fields)
			.where(
				and(
					eq(projectV2Fields.projectId, projectId),
					eq(sql`lower(${projectV2Fields.name})`, page.sort.toLowerCase()),
				),
			)
			.limit(1);
		if (field?.dataType === "NUMBER" || field?.dataType === "DATE") {
			const value =
				field.dataType === "NUMBER"
					? projectV2ItemFieldValues.valueNumber
					: projectV2ItemFieldValues.valueDate;
			sortColumn = sql`(select ${value} from ${projectV2ItemFieldValues} where ${projectV2ItemFieldValues.itemId} = ${projectV2Items.id} and ${projectV2ItemFieldValues.fieldId} = ${field.id} limit 1)`;
		}
	}
	const selection = {
		...itemSelection(),
		contentTitle: issues.title,
		contentNumber: issues.number,
		contentKind: issues.kind,
		repoOwner: sql<
			string | null
		>`coalesce(${user.username}, ${organizations.login})`,
		repoName: repositories.name,
	};
	const [items, [held], [all]] = await Promise.all([
		db
			.select(selection)
			.from(projectV2Items)
			.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
			.leftJoin(repositories, eq(repositories.id, issues.repoId))
			.leftJoin(user, eq(user.id, repositories.ownerId))
			.leftJoin(
				organizations,
				eq(organizations.id, repositories.organizationId),
			)
			.where(where)
			.orderBy(order(sortColumn), asc(projectV2Items.id))
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(projectV2Items)
			.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
			.leftJoin(repositories, eq(repositories.id, issues.repoId))
			.leftJoin(user, eq(user.id, repositories.ownerId))
			.leftJoin(
				organizations,
				eq(organizations.id, repositories.organizationId),
			)
			.where(where),
		db
			.select({ total: count() })
			.from(projectV2Items)
			.leftJoin(issues, eq(issues.id, projectV2Items.issueId))
			.leftJoin(repositories, eq(repositories.id, issues.repoId))
			.where(allWhere),
	]);
	return {
		items,
		total: Number(held?.total ?? 0),
		itemCount: Number(all?.total ?? 0),
	};
}

/** Values of many items at once, for a table page (never one query per row). */
export async function listProjectItemFieldValuesForItems(
	itemIds: readonly number[],
): Promise<ProjectItemFieldValue[]> {
	if (itemIds.length === 0) return [];
	return db
		.select(valueSelection())
		.from(projectV2ItemFieldValues)
		.innerJoin(
			projectV2Fields,
			eq(projectV2Fields.id, projectV2ItemFieldValues.fieldId),
		)
		.where(inArray(projectV2ItemFieldValues.itemId, itemIds))
		.orderBy(asc(projectV2Fields.position), asc(projectV2ItemFieldValues.id));
}

const valueColumns = {
	id: projectV2ItemFieldValues.id,
	itemId: projectV2ItemFieldValues.itemId,
	fieldId: projectV2ItemFieldValues.fieldId,
	valueText: projectV2ItemFieldValues.valueText,
	valueNumber: projectV2ItemFieldValues.valueNumber,
	valueDate: projectV2ItemFieldValues.valueDate,
	optionId: projectV2ItemFieldValues.optionId,
	updatedAt: projectV2ItemFieldValues.updatedAt,
};

function valueSelection() {
	return {
		value: valueColumns,
		field: fieldColumns,
	};
}

/** An item's values, ordered by their fields' positions. */
export async function listProjectItemFieldValues(
	itemId: number,
): Promise<ProjectItemFieldValue[]> {
	return db
		.select(valueSelection())
		.from(projectV2ItemFieldValues)
		.innerJoin(
			projectV2Fields,
			eq(projectV2Fields.id, projectV2ItemFieldValues.fieldId),
		)
		.where(eq(projectV2ItemFieldValues.itemId, itemId))
		.orderBy(asc(projectV2Fields.position), asc(projectV2ItemFieldValues.id));
}

export interface AddableProjectItem {
	id: number;
	title: string;
	number: number;
	kind: "issue" | "pull_request";
	repoOwner: string | null;
	repoName: string;
}

/**
 * Issues and pull requests the viewer can read and that are not already in
 * the project, matched by title (or an exact number), for the add-item
 * picker. The same visibility rule as `listProjectItems`.
 */
export async function searchAddableProjectItems(
	projectId: number,
	viewerId: string | null | undefined,
	query: string,
	limit: number,
): Promise<AddableProjectItem[]> {
	const search = query.trim();
	assertLength(
		search,
		MAX_PROJECT_FILTER_CHARS,
		`An item search is at most ${MAX_PROJECT_FILTER_CHARS} characters`,
	);
	const number = /^\d+$/.test(search) ? Number(search) : null;
	return db
		.select({
			id: issues.id,
			title: issues.title,
			number: issues.number,
			kind: sql<"issue" | "pull_request">`${issues.kind}`.as("kind"),
			repoOwner: sql<
				string | null
			>`coalesce(${user.username}, ${organizations.login})`,
			repoName: repositories.name,
		})
		.from(issues)
		.innerJoin(repositories, eq(repositories.id, issues.repoId))
		.leftJoin(user, eq(user.id, repositories.ownerId))
		.leftJoin(organizations, eq(organizations.id, repositories.organizationId))
		.where(
			and(
				readableForViewer(viewerId),
				sql`not exists (select 1 from ${projectV2Items} where ${projectV2Items.issueId} = ${issues.id} and ${projectV2Items.projectId} = ${projectId})`,
				sql`(${issues.kind} = 'pull_request' or ${issues.kind} = 'issue')`,
				search
					? number !== null
						? eq(issues.number, number)
						: or(ilike(issues.title, containing(search)))
					: undefined,
			),
		)
		.orderBy(desc(issues.updatedAt), asc(issues.id))
		.limit(limit);
}

/** The first value whose field has this name (GitHub's `fieldValueByName`). */
export async function findProjectItemFieldValueByName(
	itemId: number,
	name: string,
): Promise<ProjectItemFieldValue | null> {
	const [row] = await db
		.select(valueSelection())
		.from(projectV2ItemFieldValues)
		.innerJoin(
			projectV2Fields,
			eq(projectV2Fields.id, projectV2ItemFieldValues.fieldId),
		)
		.where(
			and(
				eq(projectV2ItemFieldValues.itemId, itemId),
				eq(sql`lower(${projectV2Fields.name})`, name.toLowerCase()),
			),
		)
		.orderBy(asc(projectV2Fields.position), asc(projectV2ItemFieldValues.id))
		.limit(1);
	return row ?? null;
}
