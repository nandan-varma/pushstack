import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		fumadocsMdx({ macro: { include: ["src/**/*.ts", "src/**/*.tsx"] } }),
		tailwindcss(),
		tanstackStart(),
		nitro({ preset: "vercel" }),
		viteReact(),
	],
});
