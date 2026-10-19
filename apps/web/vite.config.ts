import path from "node:path";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const serverOnlyDirs = ["db", "server"].map(
	(dir) => `${path.resolve(import.meta.dirname, "src", dir)}${path.sep}`,
);

const config = defineConfig({
	// `#/*` and `@/*` come from tsconfig.json's `paths`, resolved natively.
	resolve: { tsconfigPaths: true },
	plugins: [
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
		nitro({
			preset: "vercel",
			vercel: {
				functions: {
					// DATABASE_URL is a Neon instance in us-west-2 (Oregon); R2 is
					// Cloudflare's anycast network so it terminates at whichever edge
					// is nearest the function regardless of region, but Neon's HTTP
					// driver is a real regional round trip on every DB read/write —
					// at least one per request (session + repo lookup), often more.
					// Vercel's function region defaults to iad1 (Virginia) when
					// unset, adding a cross-country hop to every single one. pdx1
					// (Portland) is Vercel's closest region to us-west-2.
					regions: ["pdx1"],
				},
			},
			// Some CJS-only transitive deps (e.g. use-sync-external-store's
			// shim, pulled in by @tanstack/react-store) call `require("react")`
			// from inside their own CJS module body. Rolldown's CJS/ESM interop
			// can't always statically rewrite that nested require to reference
			// the already-bundled `react` module, so it falls back to a real
			// runtime `require()` (via createRequire in the generated
			// rolldown-runtime chunk) — which fails in the deployed serverless
			// function because only explicitly-traced files get shipped, not a
			// full node_modules tree. traceDeps forces nitro to physically copy
			// react's package files into the function bundle so that fallback
			// require actually resolves at runtime, without needing to fix the
			// bundler's interop decision itself.
			traceDeps: ["react*"],
			routeRules: {
				// Static security headers for every response. The
				// Content-Security-Policy is deliberately *not* here: it carries a
				// per-request nonce, so it is set by the request middleware in
				// src/server/csp.ts instead. See apps/docs/content/docs/internals/security.md.
				"/**": {
					headers: {
						"X-Content-Type-Options": "nosniff",
						"X-Frame-Options": "DENY",
						"Referrer-Policy": "strict-origin-when-cross-origin",
					},
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
