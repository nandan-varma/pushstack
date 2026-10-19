/**
 * The REST API dispatcher behind `/api/v3/*` (src/routes/api/v3.$.ts):
 * authenticates, matches the route table, runs the handler and renders
 * GitHub-shaped errors. Add an endpoint by adding a row to {@link ROUTES}.
 */
import { isGitNotFoundError } from "../git-errors";
import { logError, perfContext } from "../perf-log";
import { type ApiContext, authenticateRequest } from "./auth";
import { getBranch, listBranches } from "./branches";
import { API_PREFIX, ApiError, errorResponse, notFoundError } from "./http";
import {
	createAuthenticatedUserRepository,
	getRepository,
	listAuthenticatedUserRepositories,
	listUserRepositories,
} from "./repos";
import { listTags } from "./tags";
import { getAuthenticatedUser, getUser } from "./users";

type Handler = (ctx: ApiContext) => Promise<Response>;

interface Route {
	method: "GET" | "POST";
	/** `:name` matches one segment; a final `*name` matches the rest (slashes kept). */
	pattern: string;
	handler: Handler;
}

const ROUTES: Route[] = [
	{ method: "GET", pattern: "/user", handler: getAuthenticatedUser },
	{
		method: "GET",
		pattern: "/user/repos",
		handler: listAuthenticatedUserRepositories,
	},
	{
		method: "POST",
		pattern: "/user/repos",
		handler: createAuthenticatedUserRepository,
	},
	{ method: "GET", pattern: "/users/:username", handler: getUser },
	{
		method: "GET",
		pattern: "/users/:username/repos",
		handler: listUserRepositories,
	},
	{ method: "GET", pattern: "/repos/:owner/:repo", handler: getRepository },
	{
		method: "GET",
		pattern: "/repos/:owner/:repo/branches",
		handler: listBranches,
	},
	{
		method: "GET",
		pattern: "/repos/:owner/:repo/branches/*branch",
		handler: getBranch,
	},
	{ method: "GET", pattern: "/repos/:owner/:repo/tags", handler: listTags },
];

/** The route's parameters when `segments` match `pattern`, else null. */
function matchPattern(
	pattern: string,
	segments: string[],
): Record<string, string> | null {
	const parts = pattern.split("/").slice(1);
	const params: Record<string, string> = {};
	for (const [index, part] of parts.entries()) {
		if (part.startsWith("*")) {
			const rest = segments.slice(index);
			if (rest.length === 0) return null;
			params[part.slice(1)] = rest.join("/");
			return params;
		}
		const segment = segments[index];
		if (segment === undefined) return null;
		if (part.startsWith(":")) params[part.slice(1)] = segment;
		else if (part !== segment) return null;
	}
	return segments.length === parts.length ? params : null;
}

function matchRoute(method: string, pathname: string) {
	let segments: string[];
	try {
		segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	for (const route of ROUTES) {
		if (route.method !== method) continue;
		const params = matchPattern(route.pattern, segments);
		if (params) return { route, params };
	}
	return null;
}

export async function handleApiRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const pathname = url.pathname.startsWith(API_PREFIX)
		? url.pathname.slice(API_PREFIX.length)
		: url.pathname;
	// HEAD is GET without the body.
	const isHead = request.method === "HEAD";
	const method = isHead ? "GET" : request.method;
	const matched = matchRoute(method, pathname);
	try {
		// Credentials are checked even on unknown routes: a bad token is a 401
		// everywhere, as on GitHub.
		const caller = await authenticateRequest(request);
		if (!matched) throw notFoundError();
		const response = await perfContext(
			`api ${method} ${matched.route.pattern}`,
			() =>
				matched.route.handler({
					request,
					url,
					params: matched.params,
					caller,
				}),
		);
		return isHead
			? new Response(null, {
					status: response.status,
					headers: response.headers,
				})
			: response;
	} catch (error) {
		if (error instanceof ApiError) return errorResponse(error);
		if (isGitNotFoundError(error)) return errorResponse(notFoundError());
		logError("api", `${request.method} ${pathname} failed`, error);
		return errorResponse(new ApiError(500, "Server Error"));
	}
}
