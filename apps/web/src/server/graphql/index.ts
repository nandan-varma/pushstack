/**
 * GitHub's GraphQL API at `/api/graphql` (POST): the endpoint gh and other
 * GitHub Enterprise Server clients call. The schema is a verbatim subset of
 * GitHub's (schema.ts); authentication is the REST API's PATs, required as on
 * GitHub; limits.ts bounds each query before it runs; the cost is metered in
 * its own `graphql` bucket.
 */

import { isNotFoundError } from "git-fs-s3";
import {
	type DocumentNode,
	execute,
	GraphQLError,
	getOperationAST,
	getVariableValues,
	parse,
	specifiedRules,
	validate,
} from "graphql";
import { ApiError, errorResponse, json, readJsonObject } from "../api/http";
import {
	applyRateHeaders,
	authenticateMetered,
	RateLimitedError,
} from "../api/rate-limit";
import { currentRequestId, logError, perfContext, perfStep } from "../perf-log";
import {
	hitRateLimit,
	identityFor,
	type RateStatus,
	rateLimitExceededMessage,
} from "../rate-limit";
import { createContext, type RateLimitInfo } from "./context";
import {
	formatError,
	type GitHubFormattedError,
	GitHubGraphQLError,
} from "./errors";
import { analyzeQuery } from "./limits";
import { getSchema } from "./schema";

const GRAPHQL_DOCS =
	"https://docs.github.com/graphql/guides/forming-calls-with-graphql#authenticating-with-graphql";

/** The bounded parse: a document this large is not a client query. */
const MAX_TOKENS = 20_000;

export function handleGraphqlRequest(request: Request): Promise<Response> {
	return perfContext("graphql POST /api/graphql", async () => {
		const response = await serve(request);
		const requestId = currentRequestId();
		if (requestId) response.headers.set("X-GitHub-Request-Id", requestId);
		return response;
	});
}

const errorsBody = (errors: GitHubFormattedError[]) => ({ errors });

async function serve(request: Request): Promise<Response> {
	let rate: RateStatus | null = null;
	try {
		const caller = await authenticateMetered(request);
		if (!caller) {
			return json(
				{
					message: "This endpoint requires you to be authenticated.",
					documentation_url: GRAPHQL_DOCS,
				},
				401,
			);
		}
		const body = await readJsonObject(request);
		const { query, variables, operationName } = body;
		if (typeof query !== "string") {
			return json(
				errorsBody([
					{
						message:
							"A query attribute must be specified and must be a string.",
					},
				]),
			);
		}
		if (
			variables != null &&
			(typeof variables !== "object" || Array.isArray(variables))
		) {
			return json(errorsBody([{ message: "Variables are invalid JSON." }]));
		}
		if (operationName != null && typeof operationName !== "string") {
			return json(errorsBody([{ message: "operationName must be a string." }]));
		}

		const schema = getSchema();
		let document: DocumentNode;
		try {
			document = parse(query, { maxTokens: MAX_TOKENS });
		} catch (error) {
			if (error instanceof GraphQLError) {
				return json(errorsBody([formatError(error)]));
			}
			throw error;
		}
		const invalid = validate(schema, document, specifiedRules);
		if (invalid.length > 0) return json(errorsBody(invalid.map(formatError)));

		const operation = getOperationAST(document, operationName ?? undefined);
		if (!operation) {
			return json(
				errorsBody([
					{
						message: operationName
							? `Unknown operation named "${operationName}".`
							: "Must provide operation name if query contains multiple operations.",
					},
				]),
			);
		}
		const coerced = getVariableValues(
			schema,
			operation.variableDefinitions ?? [],
			(variables as Record<string, unknown> | null) ?? {},
		);
		if ("errors" in coerced && coerced.errors) {
			return json(errorsBody(coerced.errors.map(formatError)));
		}
		const { nodeCount, cost } = analyzeQuery(
			schema,
			document,
			operation,
			coerced.variableValues,
		);

		rate = await hitRateLimit(
			"graphql",
			identityFor(request, caller.userId),
			cost,
		);
		if (rate?.exceeded) {
			return applyRateHeaders(
				json(
					errorsBody([
						{ type: "RATE_LIMITED", message: rateLimitExceededMessage(rate) },
					]),
				),
				rate,
			);
		}
		const rateLimit: RateLimitInfo | null = rate && {
			cost,
			nodeCount,
			limit: rate.limit,
			used: rate.used,
			remaining: rate.remaining,
			resetAt: new Date(rate.reset * 1000)
				.toISOString()
				.replace(/\.\d{3}Z$/, "Z"),
		};

		const result = await perfStep(
			`graphql ${operation.name?.value ?? "(anonymous)"}`,
			async () =>
				execute({
					schema,
					document,
					operationName: operationName ?? undefined,
					variableValues: (variables as Record<string, unknown> | null) ?? {},
					contextValue: createContext(request, caller, rateLimit),
				}),
		);
		const errors = result.errors?.map(executionError);
		return applyRateHeaders(
			json({ data: result.data ?? null, ...(errors && { errors }) }),
			rate,
		);
	} catch (error) {
		if (error instanceof GitHubGraphQLError) {
			return applyRateHeaders(json(errorsBody([formatError(error)])), rate);
		}
		if (error instanceof RateLimitedError) {
			return applyRateHeaders(errorResponse(error), error.rate);
		}
		if (error instanceof ApiError) {
			return applyRateHeaders(errorResponse(error), rate);
		}
		logError("graphql", "POST /api/graphql failed", error);
		return applyRateHeaders(
			errorResponse(new ApiError(500, "Server Error")),
			rate,
		);
	}
}

/**
 * A resolver's error as GitHub reports it. Ours carry their GitHub type;
 * storage not-found is NOT_FOUND; anything else is logged and answered with
 * GitHub's generic message, never the internal one.
 */
function executionError(error: GraphQLError): GitHubFormattedError {
	const original = error.originalError;
	if (!original || original instanceof GraphQLError) return formatError(error);
	if (isNotFoundError(original)) {
		return formatError(
			new GraphQLError("Could not resolve to a node.", {
				nodes: error.nodes,
				path: error.path,
				extensions: { type: "NOT_FOUND" },
			}),
		);
	}
	logError("graphql", `resolver failed at ${error.path?.join(".")}`, original);
	return formatError(
		new GraphQLError(
			`Something went wrong while executing your query. Please include \`${currentRequestId() ?? "the request id"}\` when reporting this issue.`,
			{ nodes: error.nodes, path: error.path },
		),
	);
}
