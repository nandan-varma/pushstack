/** GitHub accepts nullable variants in mutually exclusive concrete fragments.
 * Stock gh selects User.name (String) and Team.name (String!) under
 * requestedReviewer. Keep every standard validation rule, relaxing only that
 * nullable shape difference on disjoint concrete object types.
 */
import {
	type FieldNode,
	type GraphQLCompositeType,
	type GraphQLOutputType,
	isEnumType,
	isListType,
	isNonNullType,
	isObjectType,
	Kind,
	OverlappingFieldsCanBeMergedRule,
	specifiedRules,
	TypeInfo,
	type ValidationRule,
	visit,
	visitWithTypeInfo,
} from "graphql";

function sameShape(left: GraphQLOutputType, right: GraphQLOutputType): boolean {
	if (isNonNullType(left)) return sameShape(left.ofType, right);
	if (isNonNullType(right)) return sameShape(left, right.ofType);
	if (isListType(left) || isListType(right))
		return (
			isListType(left) &&
			isListType(right) &&
			sameShape(left.ofType, right.ofType)
		);
	// GitHub answers two enums under one response name (`Issue.state` and
	// `PullRequest.state` in `gh issue view`), so enums of any name match.
	if (isEnumType(left) && isEnumType(right)) return true;
	return left === right;
}
const githubOverlappingFieldsRule: ValidationRule = (context) => {
	const types = new Map<
		FieldNode,
		{ parent: GraphQLCompositeType; type: GraphQLOutputType }
	>();
	const info = new TypeInfo(context.getSchema());
	visit(
		context.getDocument(),
		visitWithTypeInfo(info, {
			Field(node) {
				const parent = info.getParentType();
				const type = info.getType();
				if (parent && type) types.set(node, { parent, type });
			},
		}),
	);
	const report = context.reportError.bind(context);
	const wrapped = Object.create(context) as typeof context;
	wrapped.reportError = (error) => {
		// A nested conflict contains both paths, concatenated by graphql-js. Only
		// type-shape conflicts qualify; arguments, aliases and directives still fail.
		const reason = error.message
			.replace(/^Fields "[^"]+" conflict because /, "")
			.replace(
				/\. Use different aliases on the fields to fetch both if this was intentional\.$/,
				"",
			)
			.replace(/subfields "[^"]+" conflict because /g, "");
		const nodes = error.nodes;
		if (
			!/^they return conflicting types "[^"]+" and "[^"]+"(?: and they return conflicting types "[^"]+" and "[^"]+")*$/.test(
				reason,
			) ||
			!nodes ||
			nodes.length % 2 !== 0
		) {
			report(error);
			return;
		}
		const half = nodes.length / 2;
		let exclusiveDifference = false;
		for (let i = 0; i < half; i++) {
			const left = nodes[i];
			const right = nodes[i + half];
			if (
				left?.kind !== Kind.FIELD ||
				right?.kind !== Kind.FIELD ||
				(left.alias?.value ?? left.name.value) !==
					(right.alias?.value ?? right.name.value)
			) {
				report(error);
				return;
			}
			const a = types.get(left);
			const b = types.get(right);
			if (!a || !b || !sameShape(a.type, b.type)) {
				report(error);
				return;
			}
			if (String(a.type) !== String(b.type)) {
				if (
					a.parent === b.parent ||
					!isObjectType(a.parent) ||
					!isObjectType(b.parent)
				) {
					report(error);
					return;
				}
				exclusiveDifference = true;
			}
		}
		if (!exclusiveDifference) report(error);
	};
	return OverlappingFieldsCanBeMergedRule(wrapped);
};
export const githubValidationRules = specifiedRules.map((rule) =>
	rule === OverlappingFieldsCanBeMergedRule
		? githubOverlappingFieldsRule
		: rule,
);
