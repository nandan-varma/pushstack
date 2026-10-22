import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	compatibilityNotes,
	renderCompatibilityMatrix,
	withCompatibilityMatrix,
} from "../src/compat";
import { routes } from "../src/routes";

const DOC = fileURLToPath(
	new URL("../../../apps/docs/content/docs/api/index.md", import.meta.url),
);

describe("REST compatibility docs", () => {
	it("has a note for exactly the contract's operations", () => {
		expect(Object.keys(compatibilityNotes).sort()).toEqual(
			Object.keys(routes).sort(),
		);
	});

	it("lists every route once", () => {
		const matrix = renderCompatibilityMatrix();
		for (const [id, route] of Object.entries(routes)) {
			expect(matrix.split(`[\`${id}\`]`)).toHaveLength(2);
			expect(matrix).toContain(
				`\`${route.method} ${route.path.replaceAll("{+", "{")}\``,
			);
		}
	});

	it("escapes pipes in notes, including inline code", () => {
		const id = "issues/get";
		const original = compatibilityNotes[id];
		try {
			compatibilityNotes[id] = "open | closed; `open|closed`";
			const row = renderCompatibilityMatrix()
				.split("\n")
				.find((line) => line.includes(`[\`${id}\`]`));
			expect(row).toBe(
				`| \`GET /repos/{owner}/{repo}/issues/{issue_number}\` | [\`${id}\`](${routes[id].docs}) | open \\| closed; \`open\\|closed\` |`,
			);
		} finally {
			compatibilityNotes[id] = original;
		}
	});

	it("matches the generated matrix (UPDATE_DOCS=1 rewrites it)", async () => {
		const current = await readFile(DOC, "utf8");
		const generated = withCompatibilityMatrix(current);
		if (process.env.UPDATE_DOCS === "1") {
			await writeFile(DOC, generated);
			return;
		}
		expect(
			current,
			"apps/docs/content/docs/api/index.md drifted from the contract: run `pnpm --filter @pushstack/api-contract docs:matrix`",
		).toBe(generated);
	});
});
