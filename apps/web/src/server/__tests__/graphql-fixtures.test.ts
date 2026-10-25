/**
 * @vitest-environment node
 *
 * The GraphQL documents gh really sends (src/server/graphql/__fixtures__/gh,
 * captured from a pinned gh by `GH_CAPTURE_FIXTURES=1 pnpm smoke:git`):
 * every one is validated against our schema, so a field gh asks for that we
 * lack fails here, and every served one is executed against pglite data and
 * checked to answer every field it selected.
 *
 * PENDING lists the captured commands whose domain is not served yet; each
 * must still fail validation, so serving one forces moving it out of the list
 * (and gaining the execution check).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	type FieldNode,
	type FragmentDefinitionNode,
	type GraphQLCompositeType,
	getNamedType,
	isAbstractType,
	isCompositeType,
	isInterfaceType,
	isObjectType,
	Kind,
	parse,
	type SelectionSetNode,
	typeFromAST,
	validate,
} from "graphql";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const { mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { getSchema } = await import("../graphql/schema");
const { githubValidationRules } = await import("../graphql/validation");
const repositories = await import("../repositories");
const { createIssueForUser } = await import("../issue-store");
const { db } = await import("#/db");

interface Fixture {
	gh: string;
	command: string;
	requests: { query: string; variables?: Record<string, unknown> | null }[];
}

const FIXTURES_DIR = path.join(
	import.meta.dirname,
	"../graphql/__fixtures__/gh",
);
const fixtures = readdirSync(FIXTURES_DIR)
	.filter((file) => file.endsWith(".json"))
	.map((file) => ({
		name: file.replace(/\.json$/, ""),
		...(JSON.parse(
			readFileSync(path.join(FIXTURES_DIR, file), "utf8"),
		) as Fixture),
	}));

/** Captured, not served yet: the domain that will serve each. */
const PENDING: Record<string, "issues" | "pulls"> = {
	"issue-create": "issues",
	"pr-status": "pulls",
};

/** Errors a served fixture is expected to answer with (by fixture name). */
const EXPECTED_ERRORS: Record<string, string[]> = {
	"repo-view-missing": ["NOT_FOUND"],
	"pr-view": ["NOT_FOUND"],
};

const schema = getSchema();
// The first user created is apiId 1: repo-create's captured `ownerId`.
const users = await createUsers("octo", "other");
let token: string;

beforeAll(async () => {
	token = await mintToken(users.octo, ["repo:write"]);
	signIn(users.octo);
	await repositories.createRepository({
		data: {
			name: "hello",
			visibility: "public",
			description: "Hello from PushStack",
		},
	});
	await repositories.createRepository({
		data: { name: "hidden", visibility: "private" },
	});
	// `gh issue view 1` reads issue #1 of octo/hello.
	const hello = await db.query.repositories.findFirst({
		where: { name: "hello" },
	});
	if (!hello) throw new Error("octo/hello missing");
	await createIssueForUser(hello.id, users.octo.id, {
		title: "Hello issue",
		body: "Body of the hello issue.",
		labels: [],
	});
});

/**
 * Every field the selection set asks for is present in `data` (null is an
 * answer; a missing key is not), recursively, through fragments.
 */
function expectAnswered(
	parent: GraphQLCompositeType,
	selectionSet: SelectionSetNode,
	data: unknown,
	fragments: Map<string, FragmentDefinitionNode>,
	at: string,
) {
	if (data === null) return;
	if (Array.isArray(data)) {
		data.forEach((item, index) => {
			expectAnswered(parent, selectionSet, item, fragments, `${at}[${index}]`);
		});
		return;
	}
	const object = data as Record<string, unknown>;
	for (const selection of selectionSet.selections) {
		if (selection.kind === Kind.FIELD) {
			expectField(parent, selection, object, fragments, at);
			continue;
		}
		const fragment =
			selection.kind === Kind.FRAGMENT_SPREAD
				? fragments.get(selection.name.value)
				: selection;
		if (!fragment) throw new Error(`unknown fragment at ${at}`);
		const condition = fragment.typeCondition
			? typeFromAST(schema, fragment.typeCondition)
			: parent;
		if (!condition || !isCompositeType(condition)) continue;
		// A concrete condition on an abstract parent applies only to objects of
		// that type, which the data cannot tell without __typename.
		const applies =
			condition === parent ||
			isAbstractType(condition) ||
			!isAbstractType(parent) ||
			object.__typename === condition.name;
		if (applies) {
			expectAnswered(condition, fragment.selectionSet, object, fragments, at);
		}
	}
}

function expectField(
	parent: GraphQLCompositeType,
	node: FieldNode,
	object: Record<string, unknown>,
	fragments: Map<string, FragmentDefinitionNode>,
	at: string,
) {
	const key = node.alias?.value ?? node.name.value;
	expect(object, `${at}.${key} is answered`).toHaveProperty([key]);
	if (!node.selectionSet || node.name.value.startsWith("__")) return;
	if (!isObjectType(parent) && !isInterfaceType(parent)) return;
	const field = parent.getFields()[node.name.value];
	if (!field) throw new Error(`${parent.name}.${node.name.value} missing`);
	const type = getNamedType(field.type);
	if (!isCompositeType(type)) return;
	expectAnswered(
		type,
		node.selectionSet,
		object[key],
		fragments,
		`${at}.${key}`,
	);
}

describe("captured gh documents", () => {
	it("are all accounted for", () => {
		expect(fixtures.length).toBeGreaterThan(0);
		for (const name of Object.keys(PENDING)) {
			expect(fixtures.map((f) => f.name)).toContain(name);
		}
	});

	for (const fixture of fixtures) {
		const pending = PENDING[fixture.name];
		if (pending) {
			it(`${fixture.name} (${fixture.command}) is not served yet: ${pending}`, () => {
				const failing = fixture.requests.filter(
					(request) =>
						validate(schema, parse(request.query), githubValidationRules)
							.length > 0,
				);
				expect(
					failing.length,
					`${fixture.name} validates now: move it out of PENDING`,
				).toBeGreaterThan(0);
			});
			continue;
		}

		it(`${fixture.name}: ${fixture.command}`, async () => {
			for (const request of fixture.requests) {
				const document = parse(request.query);
				expect(
					validate(schema, document, githubValidationRules).map(
						(e) => e.message,
					),
				).toEqual([]);

				const { status, body } = await graphql(
					token,
					request.query,
					request.variables ?? undefined,
				);
				expect(status).toBe(200);
				expect(
					(body.errors ?? []).map((e: { type?: string }) => e.type),
				).toEqual(EXPECTED_ERRORS[fixture.name] ?? []);

				const fragments = new Map<string, FragmentDefinitionNode>();
				for (const definition of document.definitions) {
					if (definition.kind === Kind.FRAGMENT_DEFINITION) {
						fragments.set(definition.name.value, definition);
					}
				}
				for (const definition of document.definitions) {
					if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
					const root =
						definition.operation === "mutation"
							? schema.getMutationType()
							: schema.getQueryType();
					if (!root) throw new Error("no root type");
					expectAnswered(
						root,
						definition.selectionSet,
						body.data,
						fragments,
						"data",
					);
				}
			}
		});
	}
});

describe("answers gh reads", () => {
	const run = async (name: string, index = 0) => {
		const fixture = fixtures.find((f) => f.name === name);
		if (!fixture) throw new Error(`no fixture ${name}`);
		const request = fixture.requests[index];
		if (!request) throw new Error(`no request ${index} in ${name}`);
		return (await graphql(token, request.query, request.variables ?? undefined))
			.body;
	};

	it("UserCurrent: the token's login", async () => {
		expect((await run("auth-login")).data).toEqual({
			viewer: { login: "octo" },
		});
	});

	it("RepositoryInfo (clone): permissions, default branch and merge methods", async () => {
		const { data } = await run("repo-clone");
		expect(data.repository).toMatchObject({
			name: "hello",
			owner: { login: "octo" },
			viewerPermission: "ADMIN",
			hasIssuesEnabled: true,
			hasWikiEnabled: false,
			parent: null,
			mergeCommitAllowed: true,
			squashMergeAllowed: false,
			rebaseMergeAllowed: false,
		});
	});

	it("RepositoryList: the owner's repositories, private ones to their owner", async () => {
		const { data } = await run("repo-list-json");
		const owner = data.owner ?? data.repositoryOwner;
		expect(owner.login).toBe("octo");
		const names = owner.repositories.nodes.map(
			(n: { nameWithOwner: string }) => n.nameWithOwner,
		);
		expect(names).toEqual(
			expect.arrayContaining(["octo/hello", "octo/hidden"]),
		);
		expect(owner.repositories.pageInfo).toMatchObject({ hasNextPage: false });
	});

	it("RepositoryList with --visibility public filters by privacy", async () => {
		const { data } = await run("repo-list-public");
		const owner = data.owner ?? data.repositoryOwner;
		expect(
			owner.repositories.nodes.map((n: { name: string }) => n.name),
		).toEqual(["hello"]);
	});

	it("introspection gh uses for feature detection lists our fields", async () => {
		const { data } = await run("repo-list");
		const fields = data.Repository.fields.map((f: { name: string }) => f.name);
		expect(fields).toEqual(
			expect.arrayContaining(["nameWithOwner", "visibility"]),
		);
	});
});
