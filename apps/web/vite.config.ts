import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverOnlyDirs = ["db", "server"].map(
	(dir) => `${path.resolve(import.meta.dirname, "src", dir)}${path.sep}`,
);

// `pnpm dev:local` (scripts/dev-local.ts) hands the Worker its variables and a
// data directory for the simulated R2 bucket through the environment.
const localVars = process.env.PUSHSTACK_LOCAL_VARS
	? (JSON.parse(process.env.PUSHSTACK_LOCAL_VARS) as Record<string, string>)
	: undefined;

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			...(localVars && {
				config: { vars: localVars },
				persistState: {
					path: path.join(process.env.PUSHSTACK_LOCAL_DIR ?? "", "state"),
				},
			}),
		}),
		devtools(),
		tailwindcss(),
		tanstackStart({
			router: {
				// Route components are automatically split, but loaders are not by
				// default. Every loader imports its server functions, so leaving them
				// eager makes a public Git tree request initialize unrelated settings,
				// mail, write, and admin code. Load a route's loader only after its
				// already-matched route module is requested. SSR is preserved; this is
				// an explicit module boundary, not a data-cache policy.
				codeSplittingOptions: {
					defaultBehavior: [
						["component"],
						["pendingComponent"],
						["errorComponent"],
						["notFoundComponent"],
						["loader"],
					],
				},
			},
		}),
		viteReact(),
		// Source-map upload for readable Sentry stack traces — only runs when
		// SENTRY_AUTH_TOKEN is set (CI/prod release builds), so local/dev
		// builds without one aren't affected. Must come after tanstackStart().
		...(process.env.SENTRY_AUTH_TOKEN
			? [
					sentryTanstackStart({
						org: process.env.SENTRY_ORG,
						project: process.env.SENTRY_PROJECT,
						authToken: process.env.SENTRY_AUTH_TOKEN,
					}),
				]
			: []),
	],
	build: {
		rollupOptions: {
			// Server-function files keep their top-level imports in the client
			// build (only handler bodies are stripped), and `src/db` / `src/server`
			// modules run code at load (the DB client, Drizzle tables), so the
			// bundler couldn't drop them and shipped the DB driver and schema to
			// every browser. Nothing in these directories has a side effect a
			// client needs: once their exports are unused, drop them.
			treeshake: {
				moduleSideEffects: (id) =>
					!serverOnlyDirs.some((dir) => id.startsWith(dir)),
			},
			external: ["node:async_hooks", "node:stream", "node:stream/web"],
		},
	},
	// Default worker build format is 'iife', which can't code-split: shiki's
	// bundledLanguages map (src/workers/syntax-highlight.worker.ts) is ~200
	// dynamic import()s, one per grammar, meant to be lazy-loaded per
	// highlighter.loadLanguage() call. An iife worker has no module graph to
	// lazy-load from, so Vite inlines every grammar into one ~9.5MB file that
	// ships in full to any page using the worker (FileDiffViewer/CodeViewer)
	// even though `langs: []` only ever needs a handful at a time. 'es' lets
	// the worker use real dynamic import(), so each grammar becomes its own
	// small chunk fetched only when that language is actually highlighted.
	worker: {
		format: "es",
	},
	ssr: {
		noExternal: ["@tanstack/react-start", "@tanstack/react-router"],
		// Vercel Functions run Node (nitro v3 dropped the vercel-edge preset in
		// favor of Fluid compute). Server code itself only relies on Web APIs
		// plus node:async_hooks (perf-log.ts's AsyncLocalStorage).
		target: "node",
	},
});

export default config;
