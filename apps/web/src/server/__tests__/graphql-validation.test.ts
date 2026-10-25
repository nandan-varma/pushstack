/** @vitest-environment node */
import { buildSchema, parse, validate } from "graphql";
import { expect, it } from "vitest";
import { githubValidationRules } from "../graphql/validation";

const schema = buildSchema(
	`type Query { reviewer: Reviewer } union Reviewer = User | Team type User { name:String alias:String names:[String] } type Team { name:String! names:[String!]! }`,
);
const errors = (query: string) =>
	validate(schema, parse(query), githubValidationRules).map(
		(error) => error.message,
	);
it("accepts gh's nullable name variants on exclusive reviewer types", () => {
	expect(
		errors(`{ reviewer { ... on User { name } ... on Team { name } } }`),
	).toEqual([]);
});
it("keeps same-parent aliases and incompatible return shapes invalid", () => {
	expect(
		errors(`{ reviewer { ... on User { name name:alias } } }`),
	).not.toHaveLength(0);
	expect(
		errors(
			`{ reviewer { ... on User { value:name } ... on Team { value:names } } }`,
		),
	).not.toHaveLength(0);
});
it("accepts exclusive nullable list/item variants but preserves argument conflicts", () => {
	expect(
		errors(`{ reviewer { ... on User { names } ... on Team { names } } }`),
	).toEqual([]);
	const withArgs = buildSchema(`type Query { f(arg:Int):String }`);
	expect(
		validate(withArgs, parse(`{ f(arg:1) f(arg:2) }`), githubValidationRules),
	).not.toHaveLength(0);
});
