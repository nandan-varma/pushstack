/**
 * The executable schema: each domain's vendored SDL (schema/<domain>.graphql,
 * GitHub's own definitions) plus its resolvers. Built once per instance.
 */
import { buildSchema, type GraphQLSchema, isObjectType } from "graphql";
import { coreResolvers, nodeLoaders } from "./resolvers/core";
import { issuesResolvers } from "./resolvers/issues";
import { pullsResolvers } from "./resolvers/pulls";
import { repositoryResolvers } from "./resolvers/repository";
import type { DomainResolvers } from "./resolvers/types";
import coreSdl from "./schema/core.graphql?raw";
import issuesSdl from "./schema/issues.graphql?raw";
import pullsSdl from "./schema/pulls.graphql?raw";
import repositorySdl from "./schema/repository.graphql?raw";

/** In scripts/graphql-vendor.mjs's DOMAINS order: definitions before extensions. */
const DOMAINS: [string, DomainResolvers][] = [
	[coreSdl, coreResolvers],
	[repositorySdl, repositoryResolvers],
	[issuesSdl, issuesResolvers],
	[pullsSdl, pullsResolvers],
];

export const schemaSdl = DOMAINS.map(([sdl]) => sdl).join("\n");

function attach(schema: GraphQLSchema, domain: DomainResolvers) {
	for (const [typeName, fields] of Object.entries(domain.types)) {
		const type = schema.getType(typeName);
		if (!isObjectType(type)) {
			throw new Error(`Resolvers for ${typeName}, which is not an object type`);
		}
		const defined = type.getFields();
		for (const [fieldName, resolve] of Object.entries(fields)) {
			const field = defined[fieldName];
			if (!field)
				throw new Error(`Resolver for unknown ${typeName}.${fieldName}`);
			if (field.resolve)
				throw new Error(`Two resolvers for ${typeName}.${fieldName}`);
			field.resolve = resolve;
		}
	}
	for (const [typeName, load] of Object.entries(domain.nodes)) {
		if (nodeLoaders.has(typeName))
			throw new Error(`Two node loaders for ${typeName}`);
		nodeLoaders.set(typeName, load);
	}
}

let built: GraphQLSchema | undefined;

export function getSchema(): GraphQLSchema {
	if (built) return built;
	const schema = buildSchema(schemaSdl);
	// Resolvers return objects carrying `__typename`, which graphql-js's
	// default type resolver reads for interfaces and unions.
	for (const [, domain] of DOMAINS) attach(schema, domain);
	built = schema;
	return schema;
}
