import { defineConfig } from "vitest/config";

// Native-git smoke tests (scripts/smoke/): run with `pnpm smoke:git`. Kept out
// of the unit suite, which never depends on a native git binary.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["scripts/smoke/**/*.smoke.test.ts"],
		fileParallelism: false,
		testTimeout: 60_000,
		watch: false,
	},
});
