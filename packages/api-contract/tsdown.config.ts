import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/client.ts"],
	format: ["esm"],
	// Declarations come from `tsc -p tsconfig.build.json` (see the build script).
	dts: false,
	target: "node22",
	platform: "neutral",
	// Keep `.js` (the package is `"type": "module"`); tsdown defaults to `.mjs`.
	fixedExtension: false,
	sourcemap: true,
	clean: true,
});
