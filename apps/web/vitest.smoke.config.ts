import path from "node:path";
import { defineConfig } from "vitest/config";

// Smoke tests with real clients (scripts/smoke/): native git, and the stock gh
// CLI over loopback HTTPS. Run with `pnpm smoke:git`. Kept out of the unit
// suite, which never depends on a native git or gh binary.
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"cloudflare:workers": path.resolve(
				import.meta.dirname,
				"src/test/cloudflare-workers.ts",
			),
		},
	},
	test: {
		environment: "node",
		include: ["scripts/smoke/**/*.smoke.test.ts"],
		fileParallelism: false,
		testTimeout: 60_000,
		watch: false,
	},
});
