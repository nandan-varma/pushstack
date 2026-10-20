import { type OperationId, routes } from "@pushstack/api-contract/client";
import { isNotFoundError } from "git-fs-s3";
import { currentRequestId, logError, perfContext } from "../perf-log";
import type { RateStatus } from "../rate-limit";
import type { ApiContext } from "./auth";
import { getBranch, listBranches } from "./branches";
import {
	createComment,
	deleteComment,
	getComment,
	listComments,
	updateComment,
} from "./comments";
import { compareCommits, getCommitDetail, listCommits } from "./commits";
import { getContents } from "./contents";
import {
	getGitBlob,
	getGitCommit,
	getGitTree,
	getRef,
	listMatchingRefs,
	listRefs,
} from "./git-data";
import { API_PREFIX, ApiError, errorResponse, notFoundError } from "./http";
import { createIssue, getIssue, listIssues, updateIssue } from "./issues";
import {
	addIssueLabels,
	createLabel,
	deleteIssueLabels,
	deleteLabel,
	getLabel,
	listIssueLabels,
	listRepoLabels,
	removeIssueLabel,
	setIssueLabels,
	updateLabel,
} from "./labels";
import {
	checkPullMerged,
	createPull,
	getPull,
	listPullCommits,
	listPullFiles,
	listPulls,
	mergePull,
	updatePull,
} from "./pulls";
import {
	applyRateHeaders,
	authenticateMetered,
	getRateLimit,
	meterApiRequest,
	RateLimitedError,
} from "./rate-limit";
import {
	createAuthenticatedUserRepository,
	getRepository,
	listAuthenticatedUserRepositories,
	listUserRepositories,
} from "./repos";
import { matchApiRoute } from "./routing";
import { listTags } from "./tags";
import { listEvents, listTimelineItems } from "./timeline";
import { getAuthenticatedUser, getUser, getUserById } from "./users";

type Handler = (ctx: ApiContext) => Promise<Response>;

const HANDLERS = {
	"rate-limit/get": getRateLimit,
	"users/get-authenticated": getAuthenticatedUser,
	"repos/list-for-authenticated-user": listAuthenticatedUserRepositories,
	"repos/create-for-authenticated-user": createAuthenticatedUserRepository,
	"users/get-by-id": getUserById,
	"users/get-by-username": getUser,
	"repos/list-for-user": listUserRepositories,
	"repos/get": getRepository,
	"repos/list-branches": listBranches,
	"repos/get-branch": getBranch,
	"repos/list-tags": listTags,
	"repos/get-content": getContents,
	"repos/list-commits": listCommits,
	"repos/get-commit": getCommitDetail,
	"repos/compare-commits-with-basehead": compareCommits,
	"git/get-ref": getRef,
	"git/list-refs": listRefs,
	"git/list-matching-refs": listMatchingRefs,
	"git/get-commit": getGitCommit,
	"git/get-tree": getGitTree,
	"git/get-blob": getGitBlob,
	"issues/list-for-repo": listIssues,
	"issues/create": createIssue,
	"issues/get-comment": getComment,
	"issues/update-comment": updateComment,
	"issues/delete-comment": deleteComment,
	"issues/get": getIssue,
	"issues/update": updateIssue,
	"issues/list-comments": listComments,
	"issues/create-comment": createComment,
	"issues/list-events-for-timeline": listTimelineItems,
	"issues/list-events": listEvents,
	"issues/list-labels-on-issue": listIssueLabels,
	"issues/add-labels": addIssueLabels,
	"issues/set-labels": setIssueLabels,
	"issues/remove-all-labels": deleteIssueLabels,
	"issues/remove-label": removeIssueLabel,
	"pulls/list": listPulls,
	"pulls/create": createPull,
	"pulls/get": getPull,
	"pulls/update": updatePull,
	"pulls/check-if-merged": checkPullMerged,
	"pulls/merge": mergePull,
	"pulls/list-commits": listPullCommits,
	"pulls/list-files": listPullFiles,
	"issues/list-labels-for-repo": listRepoLabels,
	"issues/create-label": createLabel,
	"issues/get-label": getLabel,
	"issues/update-label": updateLabel,
	"issues/delete-label": deleteLabel,
} satisfies Record<OperationId, Handler>;

/** Every method the route table uses; `routes/api/v3.$.ts` must serve each. */
export const API_METHODS: ReadonlySet<string> = new Set(
	Object.values(routes).map((route) => route.method),
);

export function handleApiRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const pathname = url.pathname.startsWith(API_PREFIX)
		? url.pathname.slice(API_PREFIX.length)
		: url.pathname;
	const method = request.method === "HEAD" ? "GET" : request.method;
	const matched = matchApiRoute(method, pathname);
	// One request id from here on: the perf tree, logs, Sentry and the
	// response header (GitHub's X-GitHub-Request-Id) all carry it.
	return perfContext(
		`api ${method} ${matched?.pattern ?? "(no route)"}`,
		async () => {
			const response = await dispatch(request, url, pathname, matched);
			const requestId = currentRequestId();
			if (requestId) response.headers.set("X-GitHub-Request-Id", requestId);
			return response;
		},
	);
}

async function dispatch(
	request: Request,
	url: URL,
	pathname: string,
	matched: ReturnType<typeof matchApiRoute>,
): Promise<Response> {
	const isHead = request.method === "HEAD";
	let rate: RateStatus | null = null;
	try {
		// Credentials are checked even on unknown routes: a bad token is a 401
		// everywhere, as on GitHub.
		const caller = await authenticateMetered(request);
		// /rate_limit reports the buckets and is never counted, as on GitHub.
		if (matched?.id !== "rate-limit/get") {
			rate = await meterApiRequest(request, caller);
		}
		if (!matched) throw notFoundError();
		const response = await HANDLERS[matched.id]({
			request,
			url,
			params: matched.params,
			caller,
		});
		return applyRateHeaders(
			isHead
				? new Response(null, {
						status: response.status,
						headers: response.headers,
					})
				: response,
			rate,
		);
	} catch (error) {
		if (error instanceof RateLimitedError) {
			return applyRateHeaders(errorResponse(error), error.rate);
		}
		if (error instanceof ApiError)
			return applyRateHeaders(errorResponse(error), rate);
		if (isNotFoundError(error)) {
			return applyRateHeaders(errorResponse(notFoundError()), rate);
		}
		logError("api", `${request.method} ${pathname} failed`, error);
		return applyRateHeaders(
			errorResponse(new ApiError(500, "Server Error")),
			rate,
		);
	}
}
