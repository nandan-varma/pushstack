/**
 * Static query limits, checked after validation and before any resolver runs,
 * with GitHub's rules and error types:
 *
 * - every connection field needs `first` or `last`, each 1–100
 *   (MISSING_PAGINATION_BOUNDARIES / EXCESSIVE_PAGINATION);
 * - the node count — each connection's page size times its parents' — is
 *   bounded (MAX_NODE_LIMIT_EXCEEDED), so nesting cannot fan out unbounded;
 * - selection depth is bounded (MAX_DEPTH_EXCEEDED).
 *
 * It also computes GitHub's rate-limit cost: the number of connection
 * requests the query implies, divided by 100, at least 1.
 */
import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	type GraphQLCompositeType,
	type GraphQLField,
	type GraphQLSchema,
	getArgumentValues,
	getNamedType,
	isCompositeType,
	isInterfaceType,
	isObjectType,
	Kind,
	type OperationDefinitionNode,
	type SelectionSetNode,
	typeFromAST,
	type VariableValues,
} from "graphql";
import { MAX_PAGE_SIZE } from "./connection";
import { GitHubGraphQLError } from "./errors";

/**
 * GitHub allows 500,000 nodes; PushStack serves every node from its own
 * database and storage, so it is deliberately tighter.
 */
export const MAX_NODES = 50_000;
export const MAX_DEPTH = 25;

export interface QueryCost {
	nodeCount: number;
	cost: number;
}

const isConnection = (type: GraphQLCompositeType) =>
	type.name.endsWith("Connection");

export function analyzeQuery(
	schema: GraphQLSchema,
	document: DocumentNode,
	operation: OperationDefinitionNode,
	variableValues: VariableValues,
): QueryCost {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions) {
		if (definition.kind === Kind.FRAGMENT_DEFINITION) {
			fragments.set(definition.name.value, definition);
		}
	}
	const root =
		operation.operation === "mutation"
			? schema.getMutationType()
			: schema.getQueryType();
	if (!root) return { nodeCount: 0, cost: 1 };

	let nodeCount = 0;
	let requests = 0;

	const visit = (
		parent: GraphQLCompositeType,
		selectionSet: SelectionSetNode,
		multiplier: number,
		depth: number,
		spreads: ReadonlySet<string>,
	) => {
		if (depth > MAX_DEPTH) {
			throw new GitHubGraphQLError(
				"MAX_DEPTH_EXCEEDED",
				`Query has depth of ${depth}, which exceeds max depth of ${MAX_DEPTH}`,
			);
		}
		for (const selection of selectionSet.selections) {
			if (selection.kind === Kind.FIELD) {
				visitField(parent, selection, multiplier, depth, spreads);
				continue;
			}
			const fragment =
				selection.kind === Kind.FRAGMENT_SPREAD
					? fragments.get(selection.name.value)
					: selection;
			if (!fragment) continue;
			if (selection.kind === Kind.FRAGMENT_SPREAD) {
				// Validation rejects cycles; this only guards the walk itself.
				if (spreads.has(selection.name.value)) continue;
			}
			const condition = fragment.typeCondition
				? typeFromAST(schema, fragment.typeCondition)
				: parent;
			const next =
				selection.kind === Kind.FRAGMENT_SPREAD
					? new Set([...spreads, selection.name.value])
					: spreads;
			visit(
				condition && isCompositeType(condition) ? condition : parent,
				fragment.selectionSet,
				multiplier,
				depth,
				next,
			);
		}
	};

	const visitField = (
		parent: GraphQLCompositeType,
		node: FieldNode,
		multiplier: number,
		depth: number,
		spreads: ReadonlySet<string>,
	) => {
		if (!node.selectionSet) return;
		if (!isObjectType(parent) && !isInterfaceType(parent)) return;
		const field = parent.getFields()[node.name.value] as
			| GraphQLField<unknown, unknown>
			| undefined;
		if (!field) return;
		const type = getNamedType(field.type);
		if (!isCompositeType(type)) return;
		let next = multiplier;
		if (isConnection(type)) {
			const args = getArgumentValues(field, node, variableValues);
			const size = pageSize(field.name, args);
			requests += multiplier;
			next = multiplier * size;
			nodeCount += next;
			if (nodeCount > MAX_NODES) {
				throw new GitHubGraphQLError(
					"MAX_NODE_LIMIT_EXCEEDED",
					`This query requests up to ${nodeCount} possible nodes which exceeds the maximum limit of ${MAX_NODES}.`,
				);
			}
		}
		visit(type, node.selectionSet, next, depth + 1, spreads);
	};

	visit(root, operation.selectionSet, 1, 1, new Set());
	return { nodeCount, cost: Math.max(1, Math.round(requests / 100)) };
}

function pageSize(connection: string, args: Record<string, unknown>): number {
	const first = args.first as number | null | undefined;
	const last = args.last as number | null | undefined;
	if (first == null && last == null) {
		throw new GitHubGraphQLError(
			"MISSING_PAGINATION_BOUNDARIES",
			`You must provide a \`first\` or \`last\` value to properly paginate the \`${connection}\` connection.`,
		);
	}
	for (const [name, value] of [
		["first", first],
		["last", last],
	] as const) {
		if (value == null) continue;
		if (value > MAX_PAGE_SIZE) {
			throw new GitHubGraphQLError(
				"EXCESSIVE_PAGINATION",
				`Requesting ${value} records on the \`${connection}\` connection exceeds the \`${name}\` limit of ${MAX_PAGE_SIZE} records.`,
			);
		}
		if (value < 0) {
			throw new GitHubGraphQLError(
				"UNPROCESSABLE",
				`\`${name}\` on the \`${connection}\` connection cannot be less than zero.`,
			);
		}
	}
	return Math.max(first ?? 0, last ?? 0);
}
