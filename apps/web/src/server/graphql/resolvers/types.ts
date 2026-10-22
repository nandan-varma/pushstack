/**
 * The shape every domain's resolver module exports. Domains own disjoint
 * types and fields (the same split as `schema/<domain>.subset.json`), so
 * resolver modules never edit each other.
 */
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../context";

// biome-ignore lint/suspicious/noExplicitAny: resolver sources and arguments are typed per field by each domain.
export type FieldResolver<S = any, A = any> = (
	source: S,
	args: A,
	context: GraphQLContext,
	info: GraphQLResolveInfo,
) => unknown;

/** Loads the node named by a decoded global id's key; null when unreadable. */
export type NodeLoader = (
	key: string,
	context: GraphQLContext,
) => Promise<object | null>;

export interface DomainResolvers {
	/** `{ TypeName: { fieldName: resolver } }`; unlisted fields read the property. */
	types: Record<string, Record<string, FieldResolver>>;
	/** `node(id:)` loaders, by the GraphQL type name encoded in the id. */
	nodes: Record<string, NodeLoader>;
}
