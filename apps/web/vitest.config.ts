import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		tsconfigPaths: true,
		// workerd's runtime module has no Node implementation; see the stand-in.
		alias: {
			"cloudflare:workers": path.resolve(
				import.meta.dirname,
				"src/test/cloudflare-workers.ts",
			),
		},
	},
	test: {
		// Each behavior-test worker boots a workerd for its D1 database; bound memory and startup contention.
		maxWorkers: 2,
		environment: "jsdom",
		env: {
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
