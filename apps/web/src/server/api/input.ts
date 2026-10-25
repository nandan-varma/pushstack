/**
 * Typed request input for `/api/v3` handlers, parsed with the operation's
 * schemas from `@pushstack/api-contract`: path params (invalid = 404, as on
 * GitHub), query (strict values = 422, lenient ones fall back in the schema)
 * and the JSON body (422 with one error per field).
 */
import { endpoints, inputs, type OperationId } from "@pushstack/api-contract";
import type { z } from "zod";
import type { ApiContext } from "./auth";
import {
	type FieldError,
	notFoundError,
	readJsonObject,
	validationFailedError,
} from "./http";

type Endpoint<Id extends OperationId> = (typeof endpoints)[Id];
type Parsed<S> = S extends z.ZodType ? z.output<S> : never;

export type PathParams<Id extends OperationId> = Parsed<
	Endpoint<Id> extends { params: infer S } ? S : never
>;
export type QueryParams<Id extends OperationId> = Parsed<
	Endpoint<Id> extends { query: infer S } ? S : never
>;
export type RequestBody<Id extends OperationId> = Parsed<
	Endpoint<Id> extends { body: infer S } ? S : never
>;

function schemaOf(id: OperationId, part: "params" | "query" | "body") {
	const schema = (endpoints[id] as Partial<Record<typeof part, z.ZodType>>)[
		part
	];
	if (!schema) throw new Error(`${id} has no ${part} schema`);
	return schema;
}

/** The operation's path params; any invalid one is GitHub's 404. */
export function pathParams<Id extends OperationId>(
	ctx: ApiContext,
	id: Id,
): PathParams<Id> {
	const parsed = schemaOf(id, "params").safeParse(ctx.params);
	if (!parsed.success) throw notFoundError();
	return parsed.data as PathParams<Id>;
}

/** The operation's query; a strict value that fails is a 422 naming it. */
export function queryParams<Id extends OperationId>(
	ctx: ApiContext,
	id: Id,
	resource: string,
): QueryParams<Id> {
	const raw = Object.fromEntries(ctx.url.searchParams);
	const parsed = schemaOf(id, "query").safeParse(raw);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			fieldErrors(parsed.error.issues, raw, resource).map((error) => ({
				...error,
				code: "invalid",
				...(error.field !== undefined &&
					typeof raw[error.field] === "string" && {
						value: raw[error.field],
					}),
			})),
		);
	}
	return parsed.data as QueryParams<Id>;
}

/**
 * The operation's JSON body. Each failing field is one error: `missing_field`
 * when absent, `invalid` otherwise, as GitHub reports them.
 */
export async function requestBody<Id extends OperationId>(
	ctx: ApiContext,
	id: Id,
	resource: string,
	options: {
		allowEmpty?: boolean;
		/** The 422's message (GitHub varies it per endpoint). */
		message?: string;
	} = {},
): Promise<RequestBody<Id>> {
	const body = await readJsonObject(ctx.request, options);
	const parsed = schemaOf(id, "body").safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			options.message ?? "Validation Failed",
			fieldErrors(parsed.error.issues, body, resource),
		);
	}
	return parsed.data as RequestBody<Id>;
}

/**
 * Refuses a query parameter PushStack does not implement (GitHub's name, which
 * the contract declares `unsupported`). Runs before every handler, so a
 * filter is never silently dropped; the handler's own parse reports the rest.
 */
export function rejectUnsupportedQuery(url: URL, id: OperationId): void {
	const schema = (endpoints[id] as { query?: z.ZodType }).query;
	if (!schema) return;
	const raw = Object.fromEntries(url.searchParams);
	const parsed = schema.safeParse(raw);
	if (parsed.success) return;
	const refused = parsed.error.issues.filter(isUnsupported);
	if (refused.length === 0) return;
	throw validationFailedError("Validation Failed", fieldErrors(refused, raw));
}

const isUnsupported = (issue: { message: string }) =>
	issue.message === inputs.UNSUPPORTED_PARAMETER;

/**
 * One error per failing field. `resource` names the model; an unsupported
 * field is a `custom` error carrying its message instead.
 */
function fieldErrors(
	issues: readonly { path: PropertyKey[]; message: string }[],
	input: Record<string, unknown>,
	resource?: string,
): FieldError[] {
	const seen = new Set<string>();
	const errors: FieldError[] = [];
	for (const issue of issues) {
		const field = String(issue.path[0] ?? "");
		if (seen.has(field)) continue;
		seen.add(field);
		const scope = resource === undefined ? {} : { resource };
		errors.push(
			isUnsupported(issue)
				? {
						...scope,
						field,
						code: "custom",
						message: `${field} ${inputs.UNSUPPORTED_PARAMETER}`,
					}
				: {
						...scope,
						field,
						code: input[field] === undefined ? "missing_field" : "invalid",
					},
		);
	}
	return errors;
}
