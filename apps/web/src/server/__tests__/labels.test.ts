/**
 * @vitest-environment node
 *
 * Repository labels: the default set on creation, CRUD (write access only,
 * names unique ignoring case), applying labels to issues and PRs with
 * `labeled`/`unlabeled` timeline events, and the `labels` list filter.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const files = await import("../files");
const issues = await import("../issues");
const pulls = await import("../pull-requests");
const labelFns = await import("../labels");
const { getTimeline } = await import("../timeline");
const { DEFAULT_LABELS } = await import("../../lib/labels");

const users = await createUsers("owner", "reader");
let repoId: number;

const names = async () =>
	(await labelFns.getLabels({ data: { repoId } })).labels.map((l) => l.name);
const events = async (number: number) =>
	(await getTimeline({ data: { repoId, number } })).map((e) => ({
		event: e.event,
		label: "label" in e ? e.label.name : undefined,
	}));

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});
});

describe("labels", () => {
	it("starts a new repository with the default label set", async () => {
		const { labels, viewer } = await labelFns.getLabels({ data: { repoId } });
		expect(labels.map((l) => l.name)).toEqual(
			DEFAULT_LABELS.map((l) => l.name).sort((a, b) => a.localeCompare(b)),
		);
		expect(labels.find((l) => l.name === "bug")).toMatchObject({
			color: "d73a4a",
			description: "Something isn't working",
		});
		expect(viewer.canWrite).toBe(true);
	});

	it("creates, updates and deletes labels; names are unique ignoring case", async () => {
		const created = await labelFns.createLabel({
			data: { repoId, name: "P0", color: "#FF0000", description: "urgent" },
		});
		expect(created).toMatchObject({ name: "P0", color: "ff0000" });
		await expect(
			labelFns.createLabel({ data: { repoId, name: "p0", color: "00ff00" } }),
		).rejects.toThrow("already exists");
		await expect(
			labelFns.createLabel({ data: { repoId, name: "x", color: "nothex" } }),
		).rejects.toThrow();

		const renamed = await labelFns.updateLabel({
			data: { repoId, labelId: created.id, name: "priority", color: "00ff00" },
		});
		expect(renamed).toMatchObject({ name: "priority", color: "00ff00" });

		await labelFns.deleteLabel({ data: { repoId, labelId: created.id } });
		expect(await names()).not.toContain("priority");
	});

	it("needs write access to manage labels", async () => {
		signIn(users.reader);
		await expect(
			labelFns.createLabel({ data: { repoId, name: "mine", color: "000000" } }),
		).rejects.toThrow();
		signOut();
		expect(
			(await labelFns.getLabels({ data: { repoId } })).viewer.canWrite,
		).toBe(false);
		signIn(users.owner);
	});

	it("labels issues and pull requests, recording timeline events", async () => {
		const issue = await issues.createIssue({
			data: { repoId, title: "Broken", labels: ["bug", "question"] },
		});
		expect(issue.labels.map((l) => l.name)).toEqual(["bug", "question"]);
		const plain = await issues.createIssue({
			data: { repoId, title: "Plain" },
		});

		await files.createBranch({ data: { repoId, name: "side" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "side",
				path: "b.txt",
				content: btoa("b\n"),
				commitMessage: "Side",
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Side",
				sourceBranchName: "side",
				targetBranchName: "main",
			},
		});
		await labelFns.setLabels({
			data: { repoId, number: pr.number, labels: ["enhancement", "bug"] },
		});

		// Replace the set: add one, keep one, drop one.
		await labelFns.setLabels({
			data: { repoId, number: issue.number, labels: ["bug", "help wanted"] },
		});
		expect(await events(issue.number)).toEqual([
			{ event: "labeled", label: "bug" },
			{ event: "labeled", label: "question" },
			{ event: "labeled", label: "help wanted" },
			{ event: "unlabeled", label: "question" },
		]);
		await expect(
			labelFns.setLabels({
				data: { repoId, number: issue.number, labels: ["nope"] },
			}),
		).rejects.toThrow("Unknown label");
		await expect(
			labelFns.setLabels({ data: { repoId, number: 999, labels: [] } }),
		).rejects.toThrow();

		// Filters: AND across labels, case-insensitive, issues and PRs.
		const titles = async (labels: string[]) =>
			(await issues.getIssues({ data: { repoId, status: "all", labels } }))
				.map((i) => i.title)
				.sort();
		expect(await titles(["bug"])).toEqual(["Broken"]);
		expect(await titles(["BUG", "help wanted"])).toEqual(["Broken"]);
		expect(await titles(["bug", "question"])).toEqual([]);
		expect(await titles([])).toEqual(["Broken", "Plain"]);
		const prs = await pulls.getPullRequests({
			data: { repoId, status: "all", labels: ["bug", "enhancement"] },
		});
		expect(prs.map((p) => p.title)).toEqual(["Side"]);
		expect(prs[0]?.labels.map((l) => l.name)).toEqual(["bug", "enhancement"]);

		const detail = await issues.getIssueByNumber({
			data: { owner: "owner", name: "t", number: issue.number },
		});
		expect(detail.labels.map((l) => l.name)).toEqual(["bug", "help wanted"]);
		expect(plain.labels).toEqual([]);
	});

	it("deleting a label removes it from threads but keeps the history", async () => {
		const [bug] = (
			await labelFns.getLabels({ data: { repoId } })
		).labels.filter((l) => l.name === "bug");
		if (!bug) throw new Error("bug label missing");
		await labelFns.deleteLabel({ data: { repoId, labelId: bug.id } });
		const all = await issues.getIssues({
			data: { repoId, status: "all" },
		});
		expect(all.flatMap((i) => i.labels.map((l) => l.name))).not.toContain(
			"bug",
		);
		expect((await events(1)).some((e) => e.label === "bug")).toBe(true);
	});
});
