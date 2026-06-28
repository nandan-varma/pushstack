import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
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
		nitro({ preset: "vercel" }),
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
