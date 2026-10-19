import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url));
const content = path.join(app, "content/docs");

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map(async (entry) => {
				const target = path.join(dir, entry.name);
				return entry.isDirectory() ? walk(target) : [target];
			}),
		)
	).flat();
}

const files = await walk(content);
const pages = new Map(
	await Promise.all(
		files
			.filter((file) => /\.mdx?$/.test(file))
			.map(async (file) => {
				const relative = path.relative(content, file).replaceAll(path.sep, "/");
				const slug = relative
					.replace(/\.mdx?$/, "")
					.replace(/(^|\/)index$/, "")
					.replace(/\/$/, "");
				return [
					`/docs${slug ? `/${slug}` : ""}`,
					{ file, text: await readFile(file, "utf8") },
				];
			}),
	),
);

function prose(text) {
	return text.replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```/gm, "");
}

test("every content link resolves to a documentation page", () => {
	const broken = [];
	for (const [url, { file, text }] of pages) {
		const links = prose(text).matchAll(
			/\]\((\/docs[^\s)]*)\)|\bhref\s*(?:=|:)\s*["'](\/docs[^"']*)["']/g,
		);
		for (const link of links) {
			const target = new URL(link[1] ?? link[2], "https://docs.git.nandan.fyi");
			const pathname = target.pathname.replace(/\/$/, "");
			if (!pages.has(pathname))
				broken.push(
					`${path.relative(content, file)}: ${target.pathname} (from ${url})`,
				);
		}
	}
	assert.deepEqual(broken, []);
});

test("navigation entries point to pages or section directories", async () => {
	for (const file of files.filter((entry) => entry.endsWith("/meta.json"))) {
		const meta = JSON.parse(await readFile(file, "utf8"));
		for (const entry of meta.pages ?? []) {
			if (entry === "..." || entry.startsWith("---")) continue;
			const target = path.join(path.dirname(file), entry);
			assert.ok(
				files.some(
					(candidate) =>
						candidate === `${target}.md` ||
						candidate === `${target}.mdx` ||
						candidate.startsWith(`${target}/`),
				),
				`${file}: missing ${entry}`,
			);
		}
	}
});

test("library examples retain imports and reference samples are not empty", () => {
	for (const [url, { text }] of pages) {
		if (!url.startsWith("/docs/libraries/")) continue;
		assert.doesNotMatch(text, /```[^\n]*\n\s*```/, `${url}: empty code sample`);
		if (url.includes("/reference"))
			assert.match(
				text,
				/import\s+[\s\S]*?from ['"]git-/,
				`${url}: missing package import example`,
			);
	}
});

test("all pages expose titles and descriptions for navigation and search", () => {
	for (const [url, { text }] of pages) {
		const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
		assert.ok(frontmatter, `${url}: missing frontmatter`);
		assert.match(frontmatter[1], /^title: .+/m, `${url}: missing title`);
		assert.match(
			frontmatter[1],
			/^description: .+/m,
			`${url}: missing description`,
		);
	}
});
