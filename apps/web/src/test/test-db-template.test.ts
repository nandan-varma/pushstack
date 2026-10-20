/** @vitest-environment node */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { user } from "#/db/schema";
import { createTestDb } from "./pglite-db";
import {
	currentTemplateKey,
	loadTestTemplate,
	templateCacheKey,
} from "./test-db-template";

const TEMPLATE = new Uint8Array([7, 7, 7, 7]);
const roots: string[] = [];

/** A stand-in checkout holding only the files and manifests the key reads. */
async function tempRoot(schema = "export const schema = 1;\n") {
	const root = await mkdtemp(path.join(tmpdir(), "pushstack-template-"));
	roots.push(root);
	await mkdir(path.join(root, "src/db"), { recursive: true });
	for (const pkg of ["drizzle-kit", "drizzle-orm", "@electric-sql/pglite"]) {
		await mkdir(path.join(root, "node_modules", pkg), { recursive: true });
		await writeFile(
			path.join(root, "node_modules", pkg, "package.json"),
			JSON.stringify({ version: "1.0.0" }),
		);
	}
	await writeFile(path.join(root, "src/db/schema.ts"), schema);
	await writeFile(
		path.join(root, "src/db/app-schema.ts"),
		"export const appSchema = 2;\n",
	);
	return root;
}

async function readManifest(cacheDir: string) {
	return JSON.parse(
		await readFile(path.join(cacheDir, "manifest.json"), "utf8"),
	) as { version: number; key: string; templateBytes: number };
}

function build() {
	return vi.fn(async () => TEMPLATE);
}

function cacheFile(cacheDir: string, name = "manifest.json") {
	return path.join(cacheDir, name);
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("templateCacheKey", () => {
	it("changes when the content or the name of any input changes", () => {
		const base = [{ name: "a", content: "1" }];
		expect(templateCacheKey(base)).toBe(templateCacheKey([...base]));
		expect(templateCacheKey(base)).not.toBe(
			templateCacheKey([{ name: "a", content: "2" }]),
		);
		expect(templateCacheKey(base)).not.toBe(
			templateCacheKey([{ name: "b", content: "1" }]),
		);
		// Length prefixes keep `["ab"]` from colliding with `["a", "b"]`.
		expect(templateCacheKey([{ name: "x", content: "ab" }])).not.toBe(
			templateCacheKey([
				{ name: "x", content: "a" },
				{ name: "x", content: "b" },
			]),
		);
	});
});

describe("loadTestTemplate", () => {
	it("reuses the template it built while nothing it depends on changed", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		const buildTemplate = build();

		const first = await loadTestTemplate({
			root,
			cacheDir,
			build: buildTemplate,
		});
		const second = await loadTestTemplate({
			root,
			cacheDir,
			build: buildTemplate,
		});

		expect([...first]).toEqual([...TEMPLATE]);
		expect([...second]).toEqual([...TEMPLATE]);
		expect(buildTemplate).toHaveBeenCalledTimes(1);
		expect((await readManifest(cacheDir)).key).toBe(currentTemplateKey(root));
	});

	it("rebuilds when a schema file changes underneath the cache", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		const buildTemplate = build();

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });
		const before = await readManifest(cacheDir);

		await writeFile(
			path.join(root, "src/db/app-schema.ts"),
			"export const appSchema = 3;\n",
		);
		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(buildTemplate).toHaveBeenCalledTimes(2);
		const after = await readManifest(cacheDir);
		expect(after.key).not.toBe(before.key);
	});

	it("rebuilds when the PGlite version changes", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		const buildTemplate = build();

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });
		await writeFile(
			path.join(root, "node_modules/@electric-sql/pglite/package.json"),
			JSON.stringify({ version: "9.9.9" }),
		);
		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(buildTemplate).toHaveBeenCalledTimes(2);
	});

	it("rebuilds instead of loading a template keyed to another schema", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		await mkdir(cacheDir, { recursive: true });
		await writeFile(
			cacheFile(cacheDir),
			JSON.stringify({
				version: 1,
				key: "a-key-from-another-checkout",
				templateBytes: 4,
			}),
		);
		await writeFile(cacheFile(cacheDir, "template.tar.gz"), new Uint8Array(4));
		const buildTemplate = build();

		const bytes = await loadTestTemplate({
			root,
			cacheDir,
			build: buildTemplate,
		});

		expect(buildTemplate).toHaveBeenCalledTimes(1);
		expect([...bytes]).toEqual([...TEMPLATE]);
		expect((await readManifest(cacheDir)).key).toBe(currentTemplateKey(root));
	});

	it("rebuilds over a manifest without its template", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		await mkdir(cacheDir, { recursive: true });
		await writeFile(
			cacheFile(cacheDir),
			JSON.stringify({
				version: 1,
				key: currentTemplateKey(root),
				templateBytes: TEMPLATE.length,
			}),
		);
		const buildTemplate = build();

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(buildTemplate).toHaveBeenCalledTimes(1);
	});

	it("rebuilds over a truncated template", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		const buildTemplate = build();
		await loadTestTemplate({ root, cacheDir, build: buildTemplate });
		await writeFile(cacheFile(cacheDir, "template.tar.gz"), new Uint8Array(1));

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(buildTemplate).toHaveBeenCalledTimes(2);
	});

	it.each([
		["a different cache version", { version: 0, key: "k", templateBytes: 4 }],
		["a missing key", { version: 1, templateBytes: 4 }],
		["no recorded size", { version: 1, key: "k" }],
	])("rebuilds over a manifest with %s", async (_label, manifest) => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		await mkdir(cacheDir, { recursive: true });
		await writeFile(cacheFile(cacheDir), JSON.stringify(manifest));
		const buildTemplate = build();

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(buildTemplate).toHaveBeenCalledTimes(1);
	});

	it("warns and rebuilds when the manifest is unreadable", async () => {
		const root = await tempRoot();
		const cacheDir = path.join(root, "cache");
		await mkdir(cacheDir, { recursive: true });
		await writeFile(cacheFile(cacheDir), "{ not json");
		const emitWarning = vi
			.spyOn(process, "emitWarning")
			.mockImplementation(() => process);
		const buildTemplate = build();

		await loadTestTemplate({ root, cacheDir, build: buildTemplate });

		expect(emitWarning).toHaveBeenCalledOnce();
		expect(buildTemplate).toHaveBeenCalledTimes(1);
	});

	it("throws instead of returning an empty template", async () => {
		const root = await tempRoot();
		await expect(
			loadTestTemplate({
				root,
				cacheDir: path.join(root, "cache"),
				build: async () => new Uint8Array(0),
			}),
		).rejects.toThrow("template is empty");
	});
});

describe("the real checkout's key", () => {
	it("reads the schema files and tool versions", () => {
		expect(currentTemplateKey()).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("createTestDb", () => {
	it("gives every caller its own empty database", async () => {
		const first = await createTestDb();
		await first.insert(user).values({
			id: "isolated",
			name: "Isolated",
			email: "isolated@example.test",
			emailVerified: true,
			username: "isolated",
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const second = await createTestDb();

		expect(await first.select().from(user)).toHaveLength(1);
		expect(await second.select().from(user)).toHaveLength(0);
		await first.$client.close();
		await second.$client.close();
	});
});
