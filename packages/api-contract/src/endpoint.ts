/**
 * The shape of one endpoint definition, and the two pure operations every
 * side needs: building a request from typed input (clients) and matching a
 * request path against a template (the server, tests).
 */
import type { z } from "zod";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface Endpoint {
	method: Method;
	/**
	 * GitHub's path template. `{name}` is one segment; `{+name}` (RFC 6570
	 * reserved expansion) is the rest of the path, slashes kept, and may be
	 * empty — it is always last.
	 */
	path: string;
	/** GitHub's REST reference for the operation. */
	docs: string;
	/** The success status (default 200; 204 has no body). */
	status?: 200 | 201 | 204;
	params?: z.ZodType;
	query?: z.ZodType;
	body?: z.ZodType;
	/** What a success returns (`z.null()` for 204). */
	response: z.ZodType;
}

/** Keeps each definition's literal types while checking it is an {@link Endpoint}. */
export const defineEndpoints = <const T extends Record<string, Endpoint>>(
	endpoints: T,
) => endpoints;

type InputOf<S> = S extends z.ZodType ? z.input<S> : unknown;

/** A client's input: path params, query and body, flattened as Octokit takes them. */
export type EndpointInput<E extends Endpoint> = InputOf<E["params"]> &
	InputOf<E["query"]> &
	InputOf<E["body"]>;

export type EndpointResponse<E extends Endpoint> = z.output<E["response"]>;

const TOKEN = /\{(\+?)([a-z_]+)\}/g;

/** Every `{name}` / `{+name}` of a template, in order. */
export function pathParamNames(template: string): string[] {
	return [...template.matchAll(TOKEN)].map((match) => match[2] as string);
}

export interface BuiltRequest {
	method: Method;
	/** Relative to the API root, query string included. */
	path: string;
	body?: Record<string, unknown>;
}

/**
 * The request for `input`: path params fill the template (each segment
 * percent-encoded), the rest is the query for GET/DELETE, else the JSON body.
 * `undefined` values are dropped.
 */
export function buildRequest(
	endpoint: Endpoint,
	input: Record<string, unknown> = {},
): BuiltRequest {
	const rest: Record<string, unknown> = { ...input };
	let path = endpoint.path.replace(TOKEN, (_, plus: string, name: string) => {
		const value = rest[name];
		delete rest[name];
		if (value === undefined || value === null || value === "") {
			if (plus) return "";
			throw new TypeError(`missing path parameter "${name}"`);
		}
		const text = String(value);
		return plus
			? text.split("/").map(encodeURIComponent).join("/")
			: encodeURIComponent(text);
	});
	// An empty rest parameter leaves a trailing slash (`/contents/`).
	path = path.replace(/\/$/, "");
	const fields = Object.entries(rest).filter(([, v]) => v !== undefined);
	if (endpoint.method === "GET" || endpoint.method === "DELETE") {
		const query = new URLSearchParams(
			fields.map(([key, value]) => [
				key,
				Array.isArray(value) ? value.join(",") : String(value),
			]),
		).toString();
		return { method: endpoint.method, path: query ? `${path}?${query}` : path };
	}
	return {
		method: endpoint.method,
		path,
		body: fields.length ? Object.fromEntries(fields) : undefined,
	};
}

/**
 * The raw (still percent-decoded) path params when `pathname` matches
 * `template`, else null. A `{+name}` matches zero or more segments.
 */
export function matchPath(
	template: string,
	pathname: string,
): Record<string, string> | null {
	const parts = template.split("/").slice(1);
	const segments = pathname.replace(/\/+$/, "").split("/").slice(1);
	const params: Record<string, string> = {};
	try {
		for (const [index, part] of parts.entries()) {
			const token = /^\{(\+?)([a-z_]+)\}$/.exec(part);
			if (token?.[1]) {
				params[token[2] as string] = segments
					.slice(index)
					.map(decodeURIComponent)
					.join("/");
				return params;
			}
			const segment = segments[index];
			if (segment === undefined) return null;
			if (token) params[token[2] as string] = decodeURIComponent(segment);
			else if (part !== segment) return null;
		}
	} catch {
		return null; // malformed percent-encoding
	}
	return parts.length === segments.length ? params : null;
}
