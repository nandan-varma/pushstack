import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		s3: "src/stores/s3.ts",
		"fetch-s3": "src/stores/fetch-s3.ts",
		node: "src/stores/file.ts",
		ops: "src/ops/index.ts",
		http: "src/http/index.ts",
	},
	format: ["esm"],
	// Declarations come from `tsc -p tsconfig.build.json` (see the build script).
	dts: false,
	target: "node22",
	platform: "node",
	// Keep `.js` (the package is `"type": "module"`); tsdown defaults to `.mjs`.
	fixedExtension: false,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: ["@aws-sdk/client-s3", "aws4fetch", "isomorphic-git", "diff"],
	},
});
