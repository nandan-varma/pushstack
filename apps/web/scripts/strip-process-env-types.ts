/**
 * Two corrections to `wrangler types` output:
 *
 * - It declares `NodeJS.ProcessEnv` as requiring every binding, which makes any
 *   hand-built environment object (a spawned process's `env`, a test's) a type
 *   error. Server code reads configuration through `env` (src/server/env.ts),
 *   not `process.env`, so the augmentation is removed.
 * - It types a Durable Object namespace by the whole class, protected members
 *   included, which nothing but the class satisfies. The namespace is typed by
 *   its RPC surface instead (`RepositoryLockRpc`, src/env.d.ts), which the
 *   tests' in-memory lock also implements.
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = "worker-configuration.d.ts";
const source = readFileSync(file, "utf8");
const stripped = source
	.replace(/type StringifyValues<[\s\S]*?\n};\n/, "")
	.replace(/declare namespace NodeJS \{[\s\S]*?\n\}\n/, "")
	.replace(/DurableObjectNamespace<[^;\n]*>/g, "DurableObjectNamespace");
if (stripped === source) {
	throw new Error(`${file}: nothing to strip; has wrangler's output changed?`);
}
writeFileSync(file, stripped);
