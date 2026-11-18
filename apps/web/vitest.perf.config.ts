import { defineConfig } from "vitest/config";

/**
 * Timings against the local pglite + on-disk git data dir, never a cloud
 * service. `PUSHSTACK_LOCAL_DIR` is overridable so a fixture copy can be used
 * while the dev server holds the default one.
 */
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["scripts/perf/**/*.perf.ts"],
		fileParallelism: false,
		watch: false,
		testTimeout: 300_000,
		hookTimeout: 300_000,
		env: {
			PUSHSTACK_LOCAL_DIR: process.env.PERF_LOCAL_DIR ?? ".pushstack-local",
			PUSHSTACK_PERF_LOG: "0",
			DATABASE_URL: "",
			R2_BUCKET_NAME: "",
			R2_ENDPOINT: "",
			R2_ACCESS_KEY_ID: "",
			R2_SECRET_ACCESS_KEY: "",
			BETTER_AUTH_URL: "http://localhost:3000",
			BETTER_AUTH_SECRET: "pushstack-local-dev-secret-not-for-production",
		},
	},
});
