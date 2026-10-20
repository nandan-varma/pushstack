import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: { tsconfigPaths: true },
	test: {
		// Each behavior-test worker boots Postgres WASM; bound memory and startup contention.
		maxWorkers: 2,
		// `createTestDb` pushes the whole schema with drizzle-kit per test file:
		// ~0.8s alone, but several seconds when workers and other processes contend
		// for CPU (measured 4-7s; hooks exceeded the 10s default while agents ran
		// concurrently). The tests themselves never wait, so these bound the setup
		// rather than hide a hang — a stuck test still fails within 30s.
		testTimeout: 30_000,
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
