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
 * - field selections (aliases, fragments and introspection included) are
 *   bounded, and `nodes(ids:)` takes at most 100 ids.
 *
 * It also computes GitHub's rate-limit cost: the number of connection and
 * lookup requests the query implies, divided by 100, at least 1; a mutation
 * costs at least 5 per top-level mutation field, so aliasing many writes into
 * one request is charged for each. Lookups and `nodes` ids count toward the node limit.
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
/**
 * Field selections per operation, fragments expanded and introspection
 * included: bounds aliasing (a thousand `repository(...)` lookups or
 * `__schema` copies) before anything runs. gh's largest captured query
 * selects well under 200.
 */
export const MAX_FIELDS = 500;
/** GitHub's bound on `nodes(ids:)`. */
export const MAX_NODE_IDS = 100;
/** Mutations weigh more than queries, as in GitHub's secondary limits. */
export const MUTATION_COST = 5;

export interface QueryCost {
	nodeCount: number;
	cost: number;
	/** Top-level mutation fields (aliases and fragments included). */
	mutations: number;
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
	if (!root) return { nodeCount: 0, cost: 1, mutations: 0 };

	let nodeCount = 0;
	let requests = 0;
	let fields = 0;
	let mutations = 0;

	const countField = () => {
		fields += 1;
		if (fields > MAX_FIELDS) {
			throw new GitHubGraphQLError(
				"MAX_NODE_LIMIT_EXCEEDED",
				`This query selects more than ${MAX_FIELDS} fields, which exceeds the maximum of ${MAX_FIELDS}.`,
			);
		}
	};
	const addNodes = (count: number) => {
		nodeCount += count;
		if (nodeCount > MAX_NODES) {
			throw new GitHubGraphQLError(
				"MAX_NODE_LIMIT_EXCEEDED",
				`This query requests up to ${nodeCount} possible nodes which exceeds the maximum limit of ${MAX_NODES}.`,
			);
		}
	};

	/** Fields without a definition here (introspection): counted only. */
	const countOnly = (
		selectionSet: SelectionSetNode,
		spreads: ReadonlySet<string>,
	) => {
		for (const selection of selectionSet.selections) {
			if (selection.kind === Kind.FIELD) {
				countField();
				if (selection.selectionSet) countOnly(selection.selectionSet, spreads);
			} else if (selection.kind === Kind.INLINE_FRAGMENT) {
				countOnly(selection.selectionSet, spreads);
			} else {
				const name = selection.name.value;
				const fragment = fragments.get(name);
				if (fragment && !spreads.has(name)) {
					countOnly(fragment.selectionSet, new Set([...spreads, name]));
				}
			}
		}
	};

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
		countField();
		if (
			parent === root &&
			operation.operation === "mutation" &&
			!node.name.value.startsWith("__")
		) {
			mutations += 1;
		}
		if (!node.selectionSet) return;
		const field =
			isObjectType(parent) || isInterfaceType(parent)
				? (parent.getFields()[node.name.value] as
						| GraphQLField<unknown, unknown>
						| undefined)
				: undefined;
		if (!field) {
			countOnly(node.selectionSet, spreads);
			return;
		}
		const type = getNamedType(field.type);
		if (!isCompositeType(type)) return;
		let next = multiplier;
		if (isConnection(type)) {
			const args = getArgumentValues(field, node, variableValues);
			const size = pageSize(field.name, args);
			requests += multiplier;
			next = multiplier * size;
			addNodes(next);
		} else if (parent === root && field.name === "nodes") {
			const ids = getArgumentValues(field, node, variableValues)
				.ids as unknown[];
			if (ids.length > MAX_NODE_IDS) {
				throw new GitHubGraphQLError(
					"EXCESSIVE_PAGINATION",
					`Requesting ${ids.length} records on the \`nodes\` field exceeds the \`ids\` limit of ${MAX_NODE_IDS} records.`,
				);
			}
			requests += multiplier;
			next = multiplier * ids.length;
			addNodes(next);
		} else if (field.args.length > 0) {
			// A lookup (`repository(...)`, `user(login:)`, `node(id:)`): one
			// fetched node per parent.
			requests += multiplier;
			addNodes(multiplier);
		}
		visit(type, node.selectionSet, next, depth + 1, spreads);
	};

	visit(root, operation.selectionSet, 1, 1, new Set());
	const cost = Math.max(1, Math.round(requests / 100));
	return {
		nodeCount,
		cost:
			operation.operation === "mutation"
				? Math.max(MUTATION_COST * Math.max(1, mutations), cost)
				: cost,
		mutations,
	};
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
