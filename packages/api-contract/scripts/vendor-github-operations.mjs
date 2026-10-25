/**
 * Refreshes test/fixtures/github-operations.json: the query and JSON body
 * parameter names GitHub documents for each operation this contract serves.
 *
 *   node scripts/vendor-github-operations.mjs path/to/api.github.com.json
 *
 * The input is GitHub's OpenAPI description (github/rest-api-description,
 * descriptions/api.github.com/api.github.com.json). Only names are kept.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const routesSource = readFileSync(
	fileURLToPath(new URL("../src/routes.ts", import.meta.url)),
	"utf8",
);
const served = [
	...routesSource.matchAll(/^\t"([a-z-]+\/[a-z0-9-]+)": \{/gm),
].map((match) => match[1]);

const resolve = (value) =>
	value.$ref
		? value.$ref
				.split("/")
				.slice(1)
				.reduce((node, key) => node[key], spec)
		: value;

/** Property names of a body schema, including the branches of oneOf/anyOf/allOf. */
function bodyProperties(schema, names = new Set()) {
	if (!schema) return names;
	const node = resolve(schema);
	for (const key of Object.keys(node.properties ?? {})) names.add(key);
	for (const branch of [
		...(node.oneOf ?? []),
		...(node.anyOf ?? []),
		...(node.allOf ?? []),
	]) {
		bodyProperties(branch, names);
	}
	return names;
}

const operations = {};
for (const item of Object.values(spec.paths)) {
	for (const method of ["get", "post", "put", "patch", "delete"]) {
		const operation = item[method];
		if (!operation || !served.includes(operation.operationId)) continue;
		const query = (operation.parameters ?? [])
			.map(resolve)
			.filter((parameter) => parameter.in === "query")
			.map((parameter) => parameter.name)
			.sort();
		const schema = operation.requestBody?.content?.["application/json"]?.schema;
		const body = [...bodyProperties(schema)].sort();
		operations[operation.operationId] = { query, body };
	}
}

const missing = served.filter((id) => !(id in operations));
const sorted = Object.fromEntries(
	Object.entries(operations).sort(([a], [b]) => (a < b ? -1 : 1)),
);
writeFileSync(
	new URL("../test/fixtures/github-operations.json", import.meta.url),
	`${JSON.stringify({ operations: sorted, absentFromGitHub: missing }, null, 1)}\n`,
);
console.log(
	`${Object.keys(sorted).length} operations; absent from GitHub: ${missing.join(", ") || "none"}`,
);
