#!/usr/bin/env node
/**
 * Vendors the subset of GitHub's public GraphQL schema PushStack serves.
 *
 *   node scripts/graphql-vendor.mjs path/to/schema.docs.graphql
 *
 * (download it from https://docs.github.com/public/fpt/schema.docs.graphql).
 * Each domain's `src/server/graphql/schema/<domain>.subset.json` lists the
 * types and fields it serves; this script copies their definitions verbatim
 * (descriptions, arguments, types) into `<domain>.graphql`. Never edit the
 * `.graphql` files by hand: names must stay GitHub's.
 *
 * Subset format: `{ "TypeName": "*" | Fields | { "$implements": ["Iface"], "fields": Fields } }`
 * with `Fields = ["field", { "name": "field", "args": ["arg"] }]`.
 * A string field keeps every argument; an object keeps only the listed ones.
 * Enums always keep every value. The first domain (in DOMAINS order) to name a
 * type defines it; later domains emit `extend type`, so domains never edit
 * each other's files.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, Kind, parse, print } from "graphql";

export const DOMAINS = ["core", "repository", "issues", "pulls"];
const BUILT_IN = new Set(["String", "Int", "Float", "Boolean", "ID"]);
const KEPT_DIRECTIVES = new Set(["deprecated"]);

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, "../src/server/graphql/schema");

const source = process.argv[2];
if (!source) {
	console.error("usage: graphql-vendor.mjs <github schema.docs.graphql>");
	process.exit(1);
}
const github = new Map(
	parse(readFileSync(source, "utf8"))
		.definitions.filter((d) => "name" in d && d.name)
		.map((d) => [d.name.value, d]),
);

const subsets = DOMAINS.map((domain) => ({
	domain,
	types: JSON.parse(
		readFileSync(path.join(schemaDir, `${domain}.subset.json`), "utf8"),
	),
}));
const vendored = new Set(subsets.flatMap((s) => Object.keys(s.types)));

const stripDirectives = (node) => ({
	...node,
	directives: (node.directives ?? []).filter((d) =>
		KEPT_DIRECTIVES.has(d.name.value),
	),
});

const namedType = (type) =>
	type.kind === Kind.NAMED_TYPE ? type.name.value : namedType(type.type);

function pickFields(def, wanted, typeName) {
	const all = new Map(def.fields.map((f) => [f.name.value, f]));
	const picked =
		wanted === "*"
			? def.fields
			: wanted.map((entry) => {
					const name = typeof entry === "string" ? entry : entry.name;
					const field = all.get(name);
					if (!field) throw new Error(`${typeName}.${name} is not GitHub's`);
					if (typeof entry === "string" || !field.arguments) return field;
					const args = new Map(field.arguments.map((a) => [a.name.value, a]));
					return {
						...field,
						arguments: entry.args.map((arg) => {
							const found = args.get(arg);
							if (!found)
								throw new Error(`${typeName}.${name}(${arg}) is not GitHub's`);
							return found;
						}),
					};
				});
	return picked.map((field) => ({
		...stripDirectives(field),
		arguments: field.arguments?.map(stripDirectives),
	}));
}

const EXTENSION_KIND = {
	[Kind.OBJECT_TYPE_DEFINITION]: Kind.OBJECT_TYPE_EXTENSION,
	[Kind.INTERFACE_TYPE_DEFINITION]: Kind.INTERFACE_TYPE_EXTENSION,
	[Kind.INPUT_OBJECT_TYPE_DEFINITION]: Kind.INPUT_OBJECT_TYPE_EXTENSION,
	[Kind.UNION_TYPE_DEFINITION]: Kind.UNION_TYPE_EXTENSION,
};

const defined = new Set();
const referenced = new Set();
const outputs = [];

for (const { domain, types } of subsets) {
	const definitions = [];
	for (const [name, entry] of Object.entries(types)) {
		const wanted = Array.isArray(entry) || entry === "*" ? entry : entry.fields;
		const implementsOverride = Array.isArray(entry)
			? undefined
			: entry?.$implements;
		const def = github.get(name);
		if (!def) throw new Error(`${domain}: ${name} is not a GitHub type`);
		const extending = defined.has(name);
		defined.add(name);
		let node = stripDirectives(def);
		if ("fields" in def && def.fields) {
			node.fields = pickFields(def, wanted, name);
			for (const field of node.fields) {
				referenced.add(namedType(field.type));
				for (const arg of field.arguments ?? [])
					referenced.add(namedType(arg.type));
			}
		}
		if ("interfaces" in def && def.interfaces) {
			node.interfaces = extending
				? []
				: def.interfaces.filter((i) =>
						implementsOverride
							? implementsOverride.includes(i.name.value)
							: vendored.has(i.name.value),
					);
		}
		if (def.kind === Kind.UNION_TYPE_DEFINITION) {
			node.types = def.types.filter((t) =>
				wanted === "*"
					? vendored.has(t.name.value)
					: wanted.includes(t.name.value),
			);
			for (const t of node.types) referenced.add(t.name.value);
		}
		if (extending) {
			const kind = EXTENSION_KIND[def.kind];
			if (!kind) throw new Error(`${domain}: ${name} cannot be extended`);
			node = { ...node, kind, description: undefined };
		}
		definitions.push(node);
	}
	outputs.push({ domain, definitions });
}

const missing = [...referenced].filter(
	(name) => !BUILT_IN.has(name) && !defined.has(name),
);
if (missing.length > 0) {
	throw new Error(`referenced but not vendored: ${missing.sort().join(", ")}`);
}

const header = (domain) =>
	`# Generated by scripts/graphql-vendor.mjs from GitHub's public GraphQL schema\n# (https://docs.github.com/public/fpt/schema.docs.graphql). Do not edit:\n# change ${domain}.subset.json and re-run the script.\n\n`;

const sdl = [];
const written = [];
for (const { domain, definitions } of outputs) {
	const text = definitions.length
		? `${print({ kind: Kind.DOCUMENT, definitions })}\n`
		: "";
	sdl.push(text);
	const file = path.join(schemaDir, `${domain}.graphql`);
	writeFileSync(file, header(domain) + text);
	written.push(file);
}
buildSchema(sdl.join("\n"));
// The repository's formatter owns the layout, so a re-run is diff-free.
execFileSync(path.join(here, "../../../node_modules/.bin/biome"), [
	"format",
	"--write",
	...written,
]);
console.log(`vendored ${defined.size} types into ${DOMAINS.length} domains`);
