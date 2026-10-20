import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load DATABASE_URL etc. so both the dev webServer and test files (which need
// direct DB access to verify test-user emails) see the same env as `pnpm dev`.
dotenv.config({ path: ".env.local" });

export default defineConfig({
	testDir: "./e2e",

	/* All specs share one dev server, one real DB, and one auth rate limiter
	 * (20 req/60s in src/lib/auth.ts) — running workers in parallel causes
	 * cross-file request contention (rate-limit false positives) and lets
	 * client hydration lag behind test input under CPU load. Serial keeps
	 * this suite deterministic. */
	fullyParallel: false,
	workers: 1,

	forbidOnly: !!process.env.CI,

	retries: process.env.CI ? 2 : 0,

	reporter: "html",

	use: {
		baseURL: "http://localhost:3000",

		trace: "on-first-retry",

		screenshot: "only-on-failure",
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000,
	},
});
