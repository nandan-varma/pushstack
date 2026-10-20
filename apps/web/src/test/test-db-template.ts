/**
 * Builds the database every test file starts from, once per test run.
 *
 * Booting a PGlite instance costs ~470ms (warm) and `pushSchema`
 * (drizzle-kit introspection + diff) adds ~30-70ms on top, yet 22 test files
 * call `createTestDb()`. Caching the generated statements was not enough:
 * applying them is ~28ms, so almost all of the cost is the boot itself, which
 * a fresh instance pays no matter what it is then told to run. So this caches
 * the boot instead — `globalSetup` (./global-setup.ts) pushes the schema once
 * into a throwaway PGlite and dumps its data directory; `createTestDb()`
 * loads that dump into a fresh instance, which is ~3x faster.
 *
 * The cache is keyed on the *content* of everything that shapes it (the schema
 * files, the generator versions and the PGlite version), so any change makes
 * the next run rebuild instead of reusing a dump that no longer describes the
 * schema. A manifest carrying the key is written after the dump, so a stale or
 * truncated pair is always detected and rebuilt.
 *
 * Adding a file to the schema means adding it to SCHEMA_SOURCE_FILES — the key
 * only covers what is listed there. `relations.ts` is deliberately absent: it
 * feeds drizzle's relational queries, not `pushSchema`, so it does not change
 * the DDL.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api-postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as appSchema from "#/db/app-schema";
import * as authSchema from "#/db/schema";

const WEB_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** The DDL inputs; a change to any of these must change the cache key. */
export const SCHEMA_SOURCE_FILES = [
	"src/db/schema.ts",
	"src/db/app-schema.ts",
] as const;

/**
 * What turns a schema into the dump: drizzle-kit decides which statements the
 * schema implies and PGlite owns the data directory format, so a change to
 * either invalidates a dump instead of applying one they no longer produce.
 */
const GENERATOR_PACKAGES = [
	"drizzle-kit",
	"drizzle-orm",
	"@electric-sql/pglite",
] as const;

/** Bumped when the cache layout changes, to invalidate existing caches. */
const CACHE_VERSION = 1;

const CACHE_DIR = path.join(
	WEB_ROOT,
	"node_modules/.cache/pushstack",
	"test-db",
);
const MANIFEST_FILE = "manifest.json";
const TEMPLATE_FILE = "template.tar.gz";

const schema = { ...authSchema, ...appSchema };

type TemplateManifest = {
	version: number;
	key: string;
	templateBytes: number;
};

/** A key over every input, length-prefixed so concatenation cannot collide. */
export function templateCacheKey(
	parts: readonly { name: string; content: string }[],
): string {
	const hash = createHash("sha256");
	for (const { name, content } of parts) {
		hash.update(`${Buffer.byteLength(content)}\0${name}\0`);
		hash.update(content);
	}
	return hash.digest("hex");
}

/** The key the current checkout's schema files and tool versions imply. */
export function currentTemplateKey(root = WEB_ROOT): string {
	return templateCacheKey([
		...SCHEMA_SOURCE_FILES.map((file) => ({
			name: file,
			content: readFileSync(path.join(root, file), "utf8"),
		})),
		...GENERATOR_PACKAGES.map((pkg) => ({
			name: pkg,
			content: packageVersion(root, pkg),
		})),
	]);
}

function packageVersion(root: string, pkg: string): string {
	const manifest = path.join(root, "node_modules", pkg, "package.json");
	const { version } = JSON.parse(readFileSync(manifest, "utf8")) as {
		version?: unknown;
	};
	if (typeof version !== "string") {
		throw new Error(`${manifest} has no version`);
	}
	return version;
}

/** Pushes the schema into a throwaway PGlite and returns that data directory. */
export async function buildTestTemplate(): Promise<Uint8Array<ArrayBuffer>> {
	const client = new PGlite();
	try {
		const db = drizzle({ client });
		const { hints, sqlStatements } = await pushSchema(schema, db);
		const statements = [
			...hints.flatMap((hint) =>
				hint.statement === undefined ? [] : [hint.statement],
			),
			...sqlStatements,
		];
		if (statements.length === 0) {
			throw new Error("drizzle-kit generated no DDL for the test schema");
		}
		for (const statement of statements) {
			await db.execute(sql.raw(statement));
		}
		const dump = await client.dumpDataDir();
		const bytes = new Uint8Array(await dump.arrayBuffer());
		if (bytes.length === 0) {
			throw new Error("PGlite dumped an empty data directory");
		}
		return bytes;
	} finally {
		await client.close();
	}
}

/**
 * Returns the cached data directory, rebuilding it when the key no longer
 * matches the schema files and tool versions on disk.
 */
export async function loadTestTemplate(
	options: {
		cacheDir?: string;
		root?: string;
		build?: () => Promise<Uint8Array<ArrayBuffer>>;
	} = {},
): Promise<Uint8Array<ArrayBuffer>> {
	const cacheDir = options.cacheDir ?? CACHE_DIR;
	const root = options.root ?? WEB_ROOT;
	const build = options.build ?? buildTestTemplate;

	const key = currentTemplateKey(root);
	const manifest = await readManifest(path.join(cacheDir, MANIFEST_FILE));
	if (manifest !== null && manifest.key === key) {
		const cached = await readFile(path.join(cacheDir, TEMPLATE_FILE)).catch(
			() => null,
		);
		if (cached !== null && cached.length === manifest.templateBytes) {
			return new Uint8Array(cached);
		}
	}

	const bytes = await build();
	if (bytes.length === 0) {
		throw new Error("test database template is empty");
	}
	await writeCache(
		cacheDir,
		{ version: CACHE_VERSION, key, templateBytes: bytes.length },
		bytes,
	);
	return bytes;
}

async function readManifest(file: string): Promise<TemplateManifest | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<TemplateManifest>;
		if (
			parsed.version !== CACHE_VERSION ||
			typeof parsed.key !== "string" ||
			typeof parsed.templateBytes !== "number" ||
			parsed.templateBytes <= 0
		) {
			return null;
		}
		return {
			version: parsed.version,
			key: parsed.key,
			templateBytes: parsed.templateBytes,
		};
	} catch (error) {
		process.emitWarning(`ignoring unreadable test DB cache ${file}: ${error}`);
		return null;
	}
}

async function writeCache(
	dir: string,
	manifest: TemplateManifest,
	template: Uint8Array,
): Promise<void> {
	await mkdir(dir, { recursive: true });
	// The dump is written first and the manifest renamed into place second, so
	// a reader never sees a manifest describing a template that is not there.
	await writeAtomically(path.join(dir, TEMPLATE_FILE), template);
	await writeAtomically(
		path.join(dir, MANIFEST_FILE),
		`${JSON.stringify(manifest)}\n`,
	);
}

async function writeAtomically(
	file: string,
	contents: Uint8Array | string,
): Promise<void> {
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, contents);
	await rename(temporary, file);
}
