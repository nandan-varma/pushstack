/**
 * The shape every domain's resolver module exports. Domains own disjoint
 * types and fields (the same split as `schema/<domain>.subset.json`), so
 * resolver modules never edit each other.
 */
import type { GraphQLContext } from "../context";
import type { Resolvers, ResolversParentTypes } from "./generated";

/**
 * A node id as decoded: the type and key, plus (new form only) the repository
 * that owns the object and, for a reaction, its subject.
 */
export interface DecodedNodeId {
	type: string;
	key: string;
	repositoryId?: number;
	subjectId?: number;
}

/**
 * Loads the node named by a decoded global id; null when unreadable. `id` is
 * the whole decoded id, so a new-form one also names its repository.
 */
export type NodeLoader = (
	key: string,
	context: GraphQLContext,
	id?: DecodedNodeId,
) => Promise<ResolversParentTypes["Node"] | null>;

export interface DomainResolvers {
	/**
	 * `{ TypeName: { fieldName: resolver } }`, typed by `generated.ts` (from
	 * the vendored SDL, `pnpm graphql:codegen`): a resolver for a field the
	 * schema lacks, or with the wrong arguments or return type, fails
	 * `pnpm typecheck`. Unlisted fields read the property.
	 */
	types: Resolvers<GraphQLContext>;
	/** `node(id:)` loaders, by the GraphQL type name encoded in the id. */
	nodes: Record<string, NodeLoader>;
}
