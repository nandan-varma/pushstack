/**
 * A file that defines server functions is also loaded by the client, where
 * TanStack Start replaces each `createServerFn` with an RPC stub. Any other
 * runtime export keeps the file's top-level imports alive in the browser —
 * in dev (no tree shaking) that loads the database driver and
 * AsyncLocalStorage, and hydration dies. Share plain helpers from a separate
 * server-only module (e.g. repository-lookup.ts) instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverDir = path.resolve(__dirname, "..");
const files = readdirSync(serverDir).filter(
	(file) =>
		file.endsWith(".ts") &&
		/\bcreateServerFn\(/.test(readFileSync(path.join(serverDir, file), "utf8")),
);

describe("server-function files", () => {
	it.each(files)("%s exports only server functions and types", (file) => {
		const source = readFileSync(path.join(serverDir, file), "utf8");
		const offenders = [
			...source.matchAll(
				/^export\s+(?:async\s+)?(const|let|function|class)\s+(\w+)([^\n]*)/gm,
			),
		]
			.filter(
				([, kind, , rest]) =>
					!(kind === "const" && /=\s*createServerFn\(/.test(rest)),
			)
			.map(([, , name]) => name);
		expect(offenders).toEqual([]);
	});
});
