import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		fumadocsMdx({ macro: { include: ["src/**/*.ts", "src/**/*.tsx"] } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
