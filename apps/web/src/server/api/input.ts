/**
 * Typed request input for `/api/v3` handlers, parsed with the operation's
 * schemas from `@pushstack/api-contract`: path params (invalid = 404, as on
 * GitHub), query (strict values = 422, lenient ones fall back in the schema)
 * and the JSON body (422 with one error per field).
 */
import { endpoints, type OperationId } from "@pushstack/api-contract";
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
			fieldErrors(parsed.error, raw, resource).map((error) => ({
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
			fieldErrors(parsed.error, body, resource),
		);
	}
	return parsed.data as RequestBody<Id>;
}

function fieldErrors(
	error: z.ZodError,
	input: Record<string, unknown>,
	resource: string,
): FieldError[] {
	const seen = new Set<string>();
	const errors: FieldError[] = [];
	for (const issue of error.issues) {
		const field = String(issue.path[0] ?? "");
		if (seen.has(field)) continue;
		seen.add(field);
		errors.push({
			resource,
			field,
			code: input[field] === undefined ? "missing_field" : "invalid",
		});
	}
	return errors;
}
