import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

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
		tanstackStart(),
		nitro({
			preset: "vercel",
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
							"img-src 'self' data: https:",
							"font-src 'self' https://fonts.gstatic.com",
							"connect-src 'self'",
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
	ssr: {
		noExternal: ["@tanstack/react-start", "@tanstack/react-router"],
		external: ["node:fs", "node:path", "node:fs/promises"],
		target: "node", // Changed from 'webworker' to 'node' for git operations
	},
});

export default config;
