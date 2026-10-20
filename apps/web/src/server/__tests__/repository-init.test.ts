/**
 * @vitest-environment node
 *
 * "Initialize this repository with": README, .gitignore and license templates
 * written as one initial commit on main, in the same lock span as storage init.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const files = await import("../files");
const { GITIGNORE_TEMPLATE_NAMES, LICENSE_TEMPLATE_KEYS } = await import(
	"../../lib/templates"
);

const users = await createUsers("owner");
signIn(users.owner);

async function text(repoId: number, path: string): Promise<string> {
	const view = await files.getFile({
		data: { repoId, branchName: "main", path },
	});
	if (view.kind !== "text") throw new Error(`${path} is ${view.kind}`);
	return view.content;
}

async function rootNames(repoId: number): Promise<string[]> {
	const tree = await files.listFiles({
		data: { repoId, branchName: "main", path: "" },
	});
	return tree.map((entry) => entry.path).sort();
}

describe("createRepository initialization", () => {
	it("leaves the repository empty when nothing is chosen", async () => {
		const repo = await repositories.createRepository({
			data: { name: "bare" },
		});
		expect(await files.getBranches({ data: { repoId: repo.id } })).toEqual([]);
	});

	it("autoInit commits a README with the name and description", async () => {
		const repo = await repositories.createRepository({
			data: { name: "readme-only", description: "Does things", autoInit: true },
		});
		expect(await rootNames(repo.id)).toEqual(["README.md"]);
		expect(await text(repo.id, "README.md")).toBe(
			"# readme-only\n\nDoes things\n",
		);
		const commits = await files.getCommits({
			data: { repoId: repo.id, branchName: "main" },
		});
		expect(commits).toHaveLength(1);
		expect(commits[0]?.message).toBe("Initial commit");
	});

	it("autoInit without a description writes just the title", async () => {
		const repo = await repositories.createRepository({
			data: { name: "titled", autoInit: true },
		});
		expect(await text(repo.id, "README.md")).toBe("# titled\n");
	});

	it("gitignoreTemplate commits .gitignore without a README", async () => {
		const repo = await repositories.createRepository({
			data: { name: "ignore-only", gitignoreTemplate: "Node" },
		});
		expect(await rootNames(repo.id)).toEqual([".gitignore"]);
		expect(await text(repo.id, ".gitignore")).toContain("node_modules");
	});

	it("licenseTemplate fills year and owner name", async () => {
		const repo = await repositories.createRepository({
			data: { name: "mit-only", licenseTemplate: "mit" },
		});
		expect(await rootNames(repo.id)).toEqual(["LICENSE"]);
		const license = await text(repo.id, "LICENSE");
		expect(license).toContain("MIT License");
		expect(license).toContain(
			`Copyright (c) ${new Date().getUTCFullYear()} Owner`,
		);
		expect(license).not.toContain("[year]");
		expect(license).not.toContain("[fullname]");
	});

	it("renders `$` patterns in the owner name literally", async () => {
		// `$&`, `$1` and `$$` are String.replace replacement patterns; a
		// replacement string would mangle a display name that contains them.
		const fullname = "A$&B$1C$$D";
		signIn({ ...users.owner, name: fullname });
		try {
			const repo = await repositories.createRepository({
				data: { name: "dollar-license", licenseTemplate: "mit" },
			});
			const license = await text(repo.id, "LICENSE");
			expect(license).toContain(
				`Copyright (c) ${new Date().getUTCFullYear()} ${fullname}`,
			);
			expect(license).not.toContain("[fullname]");
		} finally {
			signIn(users.owner);
		}
	});

	it("all three options land in one commit", async () => {
		const repo = await repositories.createRepository({
			data: {
				name: "everything",
				autoInit: true,
				gitignoreTemplate: "Python",
				licenseTemplate: "apache-2.0",
			},
		});
		expect(await rootNames(repo.id)).toEqual([
			".gitignore",
			"LICENSE",
			"README.md",
		]);
		expect(await text(repo.id, "LICENSE")).toContain("Apache License");
		const commits = await files.getCommits({
			data: { repoId: repo.id, branchName: "main" },
		});
		expect(commits).toHaveLength(1);
		expect(repo.defaultBranch).toBe("main");
		// The lock was released: a later write goes through.
		await files.uploadFile({
			data: {
				repoId: repo.id,
				branchName: "main",
				path: "a.txt",
				content: btoa("a"),
				commitMessage: "More",
			},
		});
	});

	it("every bundled template renders", async () => {
		for (const name of GITIGNORE_TEMPLATE_NAMES) {
			const repo = await repositories.createRepository({
				data: { name: `ig-${name}`, gitignoreTemplate: name },
			});
			expect((await text(repo.id, ".gitignore")).length).toBeGreaterThan(20);
		}
		for (const key of LICENSE_TEMPLATE_KEYS) {
			const repo = await repositories.createRepository({
				data: { name: `lic-${key}`, licenseTemplate: key },
			});
			expect((await text(repo.id, "LICENSE")).length).toBeGreaterThan(500);
		}
	});

	it("rejects unknown templates", async () => {
		await expect(
			repositories.createRepository({
				// @ts-expect-error not a bundled template
				data: { name: "bad", gitignoreTemplate: "Cobol" },
			}),
		).rejects.toThrow();
		await expect(
			repositories.createRepository({
				// @ts-expect-error not a bundled template
				data: { name: "bad", licenseTemplate: "wtfpl" },
			}),
		).rejects.toThrow();
	});
});
