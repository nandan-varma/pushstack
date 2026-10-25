/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn, signOut, rejectsNotFound } = await import(
	"../../test/app-harness"
);
const { createRepository } = await import("../repositories");
const files = await import("../files");
const { getRepositoryTemplates } = await import("../repository-templates");
const users = await createUsers("template-owner", "template-outsider");
let sequence = 0;
async function setup(visibility: "public" | "private" = "public") {
	signIn(users["template-owner"]);
	return createRepository({
		data: { name: `templates-${++sequence}`, visibility },
	});
}
async function upload(
	repoId: number,
	path: string,
	content: string | Uint8Array,
	branchName = "main",
) {
	await files.uploadFile({
		data: {
			repoId,
			path,
			content: Buffer.from(content).toString("base64"),
			branchName,
			commitMessage: `Add ${path}`,
		},
	});
}
const markdown = `---\nname: Bug report\nabout: Report a bug\ntitle: '[Bug]: '\nlabels: bug, help wanted\nassignees: [template-owner]\n---\n## What happened?\n`;

describe("repository templates", () => {
	it("has no templates in an empty repository", async () => {
		const repo = await setup();
		expect(await getRepositoryTemplates({ data: { repoId: repo.id } })).toEqual(
			{
				issueTemplates: [],
				pullRequestTemplates: [],
				blankIssuesEnabled: true,
				contactLinks: [],
			},
		);
	});
	it("reads Markdown frontmatter, forms and chooser config from the default branch", async () => {
		const repo = await setup();
		await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/request.yml",
			`name: Request\ndescription: Request a change\nlabels: [enhancement]\nbody:\n  - type: markdown\n    attributes:\n      value: Thanks for helping!\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n      description: Describe the change\n      placeholder: Tell us more\n    validations:\n      required: true\n`,
		);
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/config.yml",
			`blank_issues_enabled: false\ncontact_links:\n  - name: Help\n    url: https://example.com/help\n    about: Ask a question\n`,
		);
		await files.createBranch({ data: { repoId: repo.id, name: "other" } });
		await upload(repo.id, ".github/ISSUE_TEMPLATE/other.md", markdown, "other");
		const result = await getRepositoryTemplates({ data: { repoId: repo.id } });
		expect(result.blankIssuesEnabled).toBe(false);
		expect(result.contactLinks).toEqual([
			{
				name: "Help",
				url: "https://example.com/help",
				about: "Ask a question",
			},
		]);
		expect(result.issueTemplates.map((t) => t.filename)).toEqual([
			"request.yml",
			"bug.md",
		]);
		expect(result.issueTemplates[1]).toMatchObject({
			name: "Bug report",
			description: "Report a bug",
			title: "[Bug]: ",
			body: "## What happened?\n",
			labels: ["bug", "help wanted"],
			assignees: ["template-owner"],
			form: null,
		});
		expect(result.issueTemplates[0]?.form?.[1]).toMatchObject({
			type: "textarea",
			id: "details",
			validations: { required: true },
		});
	});
	it("discovers root, docs and .github PR templates with case-insensitive filenames", async () => {
		const repo = await setup();
		await upload(repo.id, "PULL_REQUEST_TEMPLATE.md", "Root body");
		await upload(repo.id, "docs/pull_request_template.md", "Docs body");
		await upload(repo.id, ".github/pull_request_template.md", "GitHub body");
		await upload(repo.id, ".github/PULL_REQUEST_TEMPLATE/fix.md", "Fix body");
		const result = await getRepositoryTemplates({ data: { repoId: repo.id } });
		expect(result.pullRequestTemplates).toContainEqual({
			filename: ".github/pull_request_template.md",
			body: "GitHub body",
		});
		expect(result.pullRequestTemplates).toContainEqual({
			filename: ".github/PULL_REQUEST_TEMPLATE/fix.md",
			body: "Fix body",
		});
	});
	it("refreshes cached results after a default branch push", async () => {
		const repo = await setup();
		await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
		expect(
			(await getRepositoryTemplates({ data: { repoId: repo.id } }))
				.issueTemplates[0]?.name,
		).toBe("Bug report");
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/bug.md",
			markdown.replace("Bug report", "New report"),
		);
		expect(
			(await getRepositoryTemplates({ data: { repoId: repo.id } }))
				.issueTemplates[0]?.name,
		).toBe("New report");
	});
	it("hides private repository templates from anonymous users and outsiders", async () => {
		const repo = await setup("private");
		await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
		signOut();
		expect(
			await rejectsNotFound(
				getRepositoryTemplates({ data: { repoId: repo.id } }),
			),
		).toBe(true);
		signIn(users["template-outsider"]);
		expect(
			await rejectsNotFound(
				getRepositoryTemplates({ data: { repoId: repo.id } }),
			),
		).toBe(true);
	});
	it("reads every supported issue form control and preserves defaults", async () => {
		const repo = await setup();
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/form.yaml",
			`name: Details
description: Give details
body:
  - type: input
    id: version
    attributes:
      label: Version
      value: v1.0
  - type: textarea
    attributes:
      label: Logs
      render: shell
  - type: dropdown
    attributes:
      label: Platforms
      multiple: true
      options: [Linux, macOS]
      default: [0, 1]
  - type: checkboxes
    attributes:
      label: Checklist
      options:
        - label: I searched existing issues
          required: true
`,
		);
		const result = await getRepositoryTemplates({ data: { repoId: repo.id } });
		expect(result.issueTemplates[0]?.form).toEqual([
			{
				type: "input",
				id: "version",
				attributes: { label: "Version", value: "v1.0" },
			},
			{ type: "textarea", attributes: { label: "Logs", render: "shell" } },
			{
				type: "dropdown",
				attributes: {
					label: "Platforms",
					multiple: true,
					options: ["Linux", "macOS"],
					default: [0, 1],
				},
			},
			{
				type: "checkboxes",
				attributes: {
					label: "Checklist",
					options: [{ label: "I searched existing issues", required: true }],
				},
			},
		]);
	});
	it("caps discovery at 50 files across issue and PR templates", async () => {
		const repo = await setup();
		for (let index = 0; index < 51; index++) {
			await upload(
				repo.id,
				`.github/ISSUE_TEMPLATE/report-${String(index).padStart(2, "0")}.md`,
				markdown,
			);
		}
		await upload(repo.id, ".github/pull_request_template.md", "PR body");
		const result = await getRepositoryTemplates({ data: { repoId: repo.id } });
		expect(result.issueTemplates).toHaveLength(50);
		expect(result.issueTemplates.at(-1)?.filename).toBe("report-49.md");
		expect(result.pullRequestTemplates).toHaveLength(0);
	});
	it("checks UTF-8 bytes rather than character count", async () => {
		const repo = await setup();
		await upload(
			repo.id,
			".github/pull_request_template.md",
			"界".repeat(22_000),
		);
		await expect(
			getRepositoryTemplates({ data: { repoId: repo.id } }),
		).resolves.toMatchObject({ pullRequestTemplates: [] });
	});
	it("omits an oversized PR template instead of truncating the body", async () => {
		const repo = await setup();
		await upload(
			repo.id,
			".github/pull_request_template.md",
			"x".repeat(65_537),
		);
		await expect(
			getRepositoryTemplates({ data: { repoId: repo.id } }),
		).resolves.toMatchObject({ pullRequestTemplates: [] });
	});
	it.each([
		["oversized", "x".repeat(70_000)],
		["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
	] as const)(
		"omits an %s issue template while preserving valid templates",
		async (_name, content) => {
			const repo = await setup();
			await upload(repo.id, ".github/ISSUE_TEMPLATE/aaa.md", content);
			await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
			await upload(repo.id, ".github/pull_request_template.md", "PR body");
			const result = await getRepositoryTemplates({
				data: { repoId: repo.id },
			});
			expect(result.issueTemplates.map((item) => item.filename)).toEqual([
				"bug.md",
			]);
			expect(result.pullRequestTemplates[0]?.body).toBe("PR body");
		},
	);
	it("applies only trusted template metadata for a reporter without write access", async () => {
		const repo = await setup();
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/bug.md",
			markdown
				.replace("labels: bug, help wanted", "labels: bug, nonexistent-label")
				.replace(
					"assignees: [template-owner]",
					"assignees: [template-owner, nonexistent-user]",
				),
		);
		const { createIssue, getIssueByNumber } = await import("../issues");
		signIn(users["template-outsider"]);
		const created = await createIssue({
			data: {
				repoId: repo.id,
				title: "A template report",
				template: "bug.md",
				labels: ["enhancement"],
				assignees: ["template-outsider"],
			},
		});
		const loaded = await getIssueByNumber({
			data: {
				owner: "template-owner",
				name: repo.name,
				number: created.number,
			},
		});
		expect(loaded.labels.map((label) => label.name)).toEqual(["bug"]);
		expect(loaded.assignees.map((assignee) => assignee.user.username)).toEqual([
			"template-owner",
		]);
		const blank = await createIssue({
			data: {
				repoId: repo.id,
				title: "A blank report",
				labels: ["enhancement"],
				assignees: ["template-owner"],
			},
		});
		expect(blank.labels).toEqual([]);
		// Like GitHub, an unknown template name opens a blank issue instead of failing.
		const fallback = await createIssue({
			data: {
				repoId: repo.id,
				title: "Unknown template",
				template: "missing.md",
				labels: ["enhancement"],
			},
		});
		expect(fallback.labels).toEqual([]);
		expect(fallback.body).toBeNull();
	});
	it("lets a writer override trusted template metadata explicitly", async () => {
		const repo = await setup();
		await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
		const { createIssue, getIssueByNumber } = await import("../issues");
		const created = await createIssue({
			data: {
				repoId: repo.id,
				title: "A writer report",
				template: "bug.md",
				labels: ["enhancement"],
				assignees: [],
			},
		});
		const loaded = await getIssueByNumber({
			data: {
				owner: "template-owner",
				name: repo.name,
				number: created.number,
			},
		});
		expect(loaded.labels.map((label) => label.name)).toEqual(["enhancement"]);
		expect(loaded.assignees).toEqual([]);
	});
	it("omits malformed templates and config while preserving valid issue and PR templates", async () => {
		const repo = await setup();
		await upload(repo.id, ".github/ISSUE_TEMPLATE/bug.md", markdown);
		await upload(repo.id, ".github/ISSUE_TEMPLATE/broken.yml", "body: [");
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/invalid.md",
			"No frontmatter",
		);
		await upload(
			repo.id,
			".github/ISSUE_TEMPLATE/config.yml",
			"contact_links: [",
		);
		await upload(repo.id, ".github/pull_request_template.md", "PR body");
		const result = await getRepositoryTemplates({ data: { repoId: repo.id } });
		expect(result.issueTemplates.map((item) => item.filename)).toEqual([
			"bug.md",
		]);
		expect(result.blankIssuesEnabled).toBe(true);
		expect(result.pullRequestTemplates[0]?.body).toBe("PR body");
		const { createIssue } = await import("../issues");
		expect(
			await createIssue({
				data: { repoId: repo.id, title: "Report", template: "bug.md" },
			}),
		).toMatchObject({ title: "Report" });
	});
});
