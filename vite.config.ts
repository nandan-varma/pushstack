import path from "node:path";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// The browser SDK sends error/tracing envelopes straight to this origin
// (see src/router.tsx's Sentry.init) — without it in connect-src, the CSP
// silently blocks every client-side-captured error from ever reaching Sentry.
const sentryIngestOrigin = process.env.VITE_SENTRY_DSN
	? new URL(process.env.VITE_SENTRY_DSN).origin
	: undefined;

const config = defineConfig({
	resolve: {
		alias: {
			"#": path.resolve(__dirname, "./src"),
			"@": path.resolve(__dirname, "./src"),
		},
	},
	plugins: [
		devtools(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
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
				// Defense-in-depth on top of MarkdownRenderer's isSafeHref/
				// isSafeImageSrc guards (the primary control for the
				// attacker-controlled content it renders — issue/PR/comment
				// bodies, READMEs). 'unsafe-inline' stays necessary in both
				// directives: TanStack Start's SSR streaming injects small
				// inline hydration <script> tags with per-response dynamic
				// content (no static hash/nonce would match), and Shiki's
				// code-block highlighting emits inline `style` attributes per
				// token. This still blocks the more common exfiltration
				// pattern of loading a *remote* script/style from an
				// attacker-controlled origin, and blocks framing/plugins
				// entirely — see docs/security.md for the full model.
				"/**": {
					headers: {
						"Content-Security-Policy": [
							"default-src 'self'",
							"script-src 'self' 'unsafe-inline'",
							"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
							"img-src 'self' data: blob: https:",
							"font-src 'self' https://fonts.gstatic.com",
							`connect-src 'self'${sentryIngestOrigin ? ` ${sentryIngestOrigin}` : ""}`,
							"frame-ancestors 'none'",
							"base-uri 'self'",
							"object-src 'none'",
						].join("; "),
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
	server: {
		watch: {
			ignored: [
				"**/.git-repos/**",
				"**/.git_repos/**",
				"**/data/repos/**",
				"**/.pushstack/repos/**",
			],
		},
	},
	build: {
		rollupOptions: {
			external: [
				"node:async_hooks",
				"node:stream",
				"node:stream/web",
				"node:fs",
				"node:path",
			],
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
		external: ["node:fs", "node:path", "node:fs/promises"],
		target: "node", // Changed from 'webworker' to 'node' for git operations
	},
});

export default config;
