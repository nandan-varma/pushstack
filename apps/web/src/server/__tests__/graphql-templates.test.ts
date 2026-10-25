/** @vitest-environment node */
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
const { createRepository } = await import("../repositories");
const { uploadFile } = await import("../files");
const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let repoId: number;

const QUERY = `query($name: String!) {
  repository(owner: "alice", name: $name) {
    issueTemplates { name about title body filename
      labels(first: 10) { nodes { name color } totalCount }
      assignees(first: 10) { nodes { login } totalCount }
    }
    pullRequestTemplates { filename body repository { nameWithOwner } }
  }
}`;

async function write(path: string, content: string) {
	await uploadFile({
		data: {
			repoId,
			branchName: "main",
			path,
			content: btoa(content),
			commitMessage: "Add template",
		},
	});
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:read"]);
	signIn(users.alice);
	const repo = await createRepository({
		data: { name: "templates", visibility: "public" },
	});
	repoId = repo.id;
	await createRepository({ data: { name: "empty", visibility: "public" } });
	await createRepository({ data: { name: "secret", visibility: "private" } });
	await write(
		".github/ISSUE_TEMPLATE/bug.md",
		`---\nname: Bug report\nabout: Report a bug\ntitle: '[Bug] '\nlabels: bug, nonexistent\nassignees: alice, bob, nonexistent\n---\nDescribe the bug.\n`,
	);
	await write(".github/pull_request_template.md", "## Changes\n\n## Testing\n");
	await write(
		".github/ISSUE_TEMPLATE/question.yml",
		"name: Question\ndescription: Ask a question\nbody:\n  - type: input\n    attributes:\n      label: Question\n",
	);
});

describe("Repository templates", () => {
	it("answers gh's template fields, excludes YAML forms, and resolves known labels and assignable users", async () => {
		const { body } = await graphql(bob, QUERY, { name: "templates" });
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.issueTemplates).toEqual([
			{
				name: "Bug report",
				about: "Report a bug",
				title: "[Bug] ",
				body: "Describe the bug.\n",
				filename: "bug.md",
				labels: { nodes: [{ name: "bug", color: "d73a4a" }], totalCount: 1 },
				assignees: { nodes: [{ login: "alice" }], totalCount: 1 },
			},
		]);
		expect(body.data.repository.pullRequestTemplates).toEqual([
			{
				filename: "pull_request_template.md",
				body: "## Changes\n\n## Testing\n",
				repository: { nameWithOwner: "alice/templates" },
			},
		]);
	});

	it("returns empty template lists for an empty repository", async () => {
		const { body } = await graphql(alice, QUERY, { name: "empty" });
		expect(body.errors).toBeUndefined();
		expect(body.data.repository).toEqual({
			issueTemplates: [],
			pullRequestTemplates: [],
		});
	});

	it("does not reveal templates in unreadable repositories", async () => {
		const { body } = await graphql(bob, QUERY, { name: "secret" });
		expect(body.data.repository).toBeNull();
		expect(body.errors[0].type).toBe("NOT_FOUND");
	});

	it("propagates invalid template configuration as a GraphQL error", async () => {
		await write(
			".github/ISSUE_TEMPLATE/config.yml",
			"blank_issues_enabled: [\n",
		);
		const { body } = await graphql(alice, QUERY, { name: "templates" });
		expect(body.errors).toBeDefined();
		expect(body.errors.length).toBeGreaterThan(0);
	});
});
