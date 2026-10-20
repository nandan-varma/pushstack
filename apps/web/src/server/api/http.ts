import { getGitBaseUrl } from "#/lib/git-utils";
import { MAX_API_BODY_BYTES, MAX_LIST_SKIP } from "#/lib/limits";

export const API_PREFIX = "/api/v3";
const DOCUMENTATION_URL = "https://docs.github.com/rest";

export interface FieldError {
	resource: string;
	field?: string;
	code: "missing" | "missing_field" | "invalid" | "already_exists" | "custom";
	message?: string;
	/** The rejected value, which GitHub includes for some `invalid` errors. */
	value?: string;
}

/** Thrown by handlers; the dispatcher renders it as GitHub's error body. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly errors?: FieldError[],
	) {
		super(message);
	}
}

export const notFoundError = (message = "Not Found") =>
	new ApiError(404, message);
export const badCredentialsError = () => new ApiError(401, "Bad credentials");
export const requiresAuthenticationError = () =>
	new ApiError(401, "Requires authentication");
export const insufficientScopeError = () =>
	new ApiError(403, "Resource not accessible by personal access token");
/** Authenticated, but not allowed to do this to this resource (GitHub: 403). */
export const forbiddenError = (message: string) => new ApiError(403, message);
export const validationFailedError = (message: string, errors: FieldError[]) =>
	new ApiError(422, message, errors);

const BASE_HEADERS = {
	"Content-Type": "application/json; charset=utf-8",
	"X-GitHub-Media-Type": "github.v3; format=json",
	"Cache-Control": "private, no-cache",
};

export function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...BASE_HEADERS, ...headers },
	});
}

export function errorResponse(error: ApiError): Response {
	return json(
		{
			message: error.message,
			...(error.errors && { errors: error.errors }),
			documentation_url: DOCUMENTATION_URL,
			status: String(error.status),
		},
		error.status,
	);
}

export function noContent(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"X-GitHub-Media-Type": "github.v3; format=json",
			"Cache-Control": "private, no-cache",
		},
	});
}

export const apiUrl = (path: string) =>
	`${getGitBaseUrl()}${API_PREFIX}${path}`;
export const htmlUrl = (path: string) => `${getGitBaseUrl()}${path}`;

export const encodePath = (path: string) =>
	path.split("/").map(encodeURIComponent).join("/");

/** GitHub's timestamp format: ISO-8601 UTC without milliseconds. */
export const isoTimestamp = (date: Date) =>
	date.toISOString().replace(/\.\d{3}Z$/, "Z");

export const DEFAULT_PER_PAGE = 30;
export const MAX_PER_PAGE = 100;

export interface PageParams {
	page: number;
	perPage: number;
	offset: number;
	/** False past `MAX_LIST_SKIP` items: such a page is empty. */
	reachable: boolean;
}

/** `page` / `per_page` like GitHub: bad values fall back, `per_page` caps at 100. */
export function pageParams(query: URLSearchParams): PageParams {
	const positiveInt = (name: string) => {
		const raw = query.get(name);
		if (raw === null || !/^\d+$/.test(raw)) return null;
		const value = Number(raw);
		return value >= 1 ? value : null;
	};
	const perPage = Math.min(
		positiveInt("per_page") ?? DEFAULT_PER_PAGE,
		MAX_PER_PAGE,
	);
	const page = positiveInt("page") ?? 1;
	const offset = (page - 1) * perPage;
	return { page, perPage, offset, reachable: offset <= MAX_LIST_SKIP };
}

/**
 * GitHub's `Link` header: first/prev/next/last for the other pages, nothing
 * when everything fits on one page. Keeps the request's other query params.
 */
export function linkHeader(
	url: URL,
	{ page, perPage }: PageParams,
	total: number,
): Record<string, string> {
	const deepest = Math.floor(MAX_LIST_SKIP / perPage) + 1;
	const lastPage = Math.max(1, Math.min(Math.ceil(total / perPage), deepest));
	if (lastPage === 1) return {};
	const link = (target: number, rel: string) => {
		const query = new URLSearchParams(url.search);
		query.set("page", String(target));
		return `<${getGitBaseUrl()}${url.pathname}?${query}>; rel="${rel}"`;
	};
	const links: string[] = [];
	if (page > 1) links.push(link(page - 1, "prev"));
	if (page < lastPage) links.push(link(page + 1, "next"));
	if (page < lastPage) links.push(link(lastPage, "last"));
	if (page > 1) links.push(link(1, "first"));
	return { Link: links.join(", ") };
}

export function pagedList<T, R>(
	url: URL,
	items: T[],
	serialize: (item: T) => R,
): Response {
	const params = pageParams(url.searchParams);
	const slice = params.reachable
		? items.slice(params.offset, params.offset + params.perPage)
		: [];
	return json(slice.map(serialize), 200, linkHeader(url, params, items.length));
}

/**
 * The request's JSON object body; 400 like GitHub when it isn't one (or, when
 * `allowEmpty`, when it is neither empty nor one).
 */
export async function readJsonObject(
	request: Request,
	options: { allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
	const invalid = () => new ApiError(400, "Problems parsing JSON");
	const tooLarge = () => new ApiError(413, "Request body too large");
	const declaredHeader = request.headers.get("content-length");
	if (declaredHeader !== null) {
		if (!/^\d+$/.test(declaredHeader)) throw invalid();
		if (Number(declaredHeader) > MAX_API_BODY_BYTES) throw tooLarge();
	}
	// Counted while streaming: a chunked body declares no length at all.
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_API_BODY_BYTES) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	// Some GitHub endpoints (a merge) take an optional body.
	if (total === 0 && options.allowEmpty) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw invalid();
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw invalid();
	}
	return parsed as Record<string, unknown>;
}
