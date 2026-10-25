/**
 * Resolver types from the vendored GitHub SDL: `pnpm graphql:codegen` writes
 * `src/server/graphql/resolvers/generated.ts`, which is committed and checked
 * for drift by `graphql-codegen.test.ts`. Mappers name the objects our
 * resolvers pass around instead of the schema's field-by-field shape.
 *
 * It drives `@graphql-codegen/core` directly rather than the CLI: the CLI's
 * file loaders pull a high-severity `braces` advisory (no patched release)
 * into the tree, and nothing here needs them.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codegen } from "@graphql-codegen/core";
import * as typescript from "@graphql-codegen/typescript";
import * as typescriptResolvers from "@graphql-codegen/typescript-resolvers";
import { concatAST, parse } from "graphql";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = path.join(root, "src/server/graphql/schema");
export const GENERATED = path.join(
	root,
	"src/server/graphql/resolvers/generated.ts",
);

/** Definitions before extensions, as schema.ts concatenates them. */
const DOMAINS = ["core", "repository", "issues", "pulls"];

export async function generateResolverTypes(): Promise<string> {
	// A domain not served yet is comments only, which is not a document.
	const sources = DOMAINS.map((domain) =>
		readFileSync(path.join(schemaDir, `${domain}.graphql`), "utf8"),
	).filter((sdl) => /^\s*[^#\s]/m.test(sdl));
	const document = concatAST(sources.map((sdl) => parse(sdl)));
	const unlisted = readdirSync(schemaDir).filter(
		(file) =>
			file.endsWith(".graphql") &&
			!DOMAINS.includes(file.replace(/\.graphql$/, "")),
	);
	if (unlisted.length > 0) {
		throw new Error(`Add ${unlisted.join(", ")} to DOMAINS in this script`);
	}
	return codegen({
		filename: GENERATED,
		documents: [],
		schema: document,
		plugins: [{ typescript: {} }, { "typescript-resolvers": {} }],
		pluginMap: {
			typescript,
			"typescript-resolvers": typescriptResolvers,
		},
		config: {
			useTypeImports: true,
			enumsAsTypes: true,
			contextType: "../context#GraphQLContext",
			scalars: {
				DateTime: "string",
				URI: "string",
				GitSSHRemote: "string",
				GitObjectID: "string",
			},
			mappers: {
				User: "./core#UserNode",
				Repository: "./repository#RepositoryNode",
				Ref: "./repository#RefNode",
				Commit: "./commit#CommitNode",
				Issue: "./issues#IssueNode",
				PullRequest: "./pulls#PullRequestNode",
				PullRequestReview: "./pulls-detail#ReviewNode",
				IssueComment: "./pulls-detail#CommentNode",
				StatusCheckRollup: "./pulls-detail#RollupNode",
				Release: "./releases#ReleaseNode",
				IssueTemplate: "./templates#IssueTemplateNode",
				ReleaseAsset: "./releases#ReleaseAssetNode",
				RateLimit: "../context#RateLimitInfo",
			},
		},
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(GENERATED, await generateResolverTypes());
}
