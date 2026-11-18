import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: { tsconfigPaths: true },
	test: {
		// Each behavior-test worker boots Postgres WASM; bound memory and startup
		// contention. CI sets VITEST_MAX_WORKERS=4 to use its four vCPUs; a
		// developer machine keeps two so parallel agents do not starve it.
		maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 2),
		globalSetup: ["./src/test/global-setup.ts"],
		environment: "jsdom",
		// src/db requires a URL at import; nothing connects until a query runs.
		env: {
			DATABASE_URL: "postgresql://test@localhost/test",
			// Out of the way of unrelated tests (they share one anonymous IP);
			// rate-limit tests set their own small values.
			RATE_LIMIT_API_ANONYMOUS: "1000000",
			RATE_LIMIT_API_AUTHENTICATED: "1000000",
			RATE_LIMIT_API_WRITE: "1000000",
			RATE_LIMIT_GIT_READ_ANONYMOUS: "1000000",
			RATE_LIMIT_GIT_READ_AUTHENTICATED: "1000000",
			RATE_LIMIT_GIT_WRITE: "1000000",
			RATE_LIMIT_AUTH_FAILURES: "1000000",
		},
		setupFiles: ["./src/test/setup.ts"],
		globals: true,
		css: true,
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
