/**
 * The `/api/v3` contract: {@link endpoints} (one definition per operation,
 * keyed by GitHub's operation id) and the resource schemas they share.
 */
import {
	type BuiltRequest,
	buildRequest,
	type Endpoint,
	type EndpointInput,
	type EndpointResponse,
	type Method,
	matchPath,
} from "./endpoint";
import { type Endpoints, endpoints, type OperationId } from "./endpoints";

export * from "./endpoint";
export * from "./endpoints";
export * as inputs from "./inputs";
export * as limits from "./limits";
export * as resources from "./resources";

export type Input<Id extends OperationId> = EndpointInput<Endpoints[Id]>;
export type Output<Id extends OperationId> = EndpointResponse<Endpoints[Id]>;

/** Operations whose response is a page of a list (they take `page`/`per_page`). */
export type ListOperationId = {
	[Id in OperationId]: Output<Id> extends unknown[]
		? Input<Id> extends { per_page?: unknown }
			? Id
			: never
		: never;
}[OperationId];

/** `[input]`, or `[input?]` when nothing is required. */
export type InputArgs<Id extends OperationId> =
	Record<string, never> extends Input<Id>
		? [input?: Input<Id>]
		: [input: Input<Id>];

/** The request for operation `id` (typed input; not validated client-side). */
export function requestFor<Id extends OperationId>(
	id: Id,
	...[input]: InputArgs<Id>
): BuiltRequest {
	return buildRequest(
		endpoints[id] as Endpoint,
		input as Record<string, unknown> | undefined,
	);
}

const table = Object.entries(endpoints) as [OperationId, Endpoint][];

/** The operation `method pathname` names (first match wins), with its raw params. */
export function matchEndpoint(
	method: Method,
	pathname: string,
): {
	id: OperationId;
	endpoint: Endpoint;
	params: Record<string, string>;
} | null {
	for (const [id, endpoint] of table) {
		if (endpoint.method !== method) continue;
		const params = matchPath(endpoint.path, pathname);
		if (params) return { id, endpoint, params };
	}
	return null;
}
