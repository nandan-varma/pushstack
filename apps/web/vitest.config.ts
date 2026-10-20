import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: { tsconfigPaths: true },
	test: {
		// Each behavior-test worker boots Postgres WASM; bound memory and startup contention.
		maxWorkers: 2,
		// Seeding hooks push the whole schema with drizzle-kit into a fresh
		// Postgres WASM instance: measured 545-908ms warm per file, several
		// seconds when workers and other processes contend for CPU, which crossed
		// vitest's 10s default. Only the hooks get the wider bound — test bodies
		// keep the default so a slow body still fails fast.
		hookTimeout: 30_000,
		environment: "jsdom",
		// src/db requires a URL at import; nothing connects until a query runs.
		env: { DATABASE_URL: "postgresql://test@localhost/test" },
		setupFiles: ["./src/test/setup.ts"],
		globals: true,
		css: true,
		typecheck: { enabled: true },
		watch: false,
		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		exclude: ["node_modules", "dist", "e2e", ".idea", ".git", ".cache"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/",
				"src/test/",
				"**/*.d.ts",
				"**/*.config.*",
				"**/mockData",
				"routeTree.gen.ts",
				"e2e/**",
			],
		},
	},
});
