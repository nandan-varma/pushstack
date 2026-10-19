/**
 * Bundled "Initialize this repository with" template texts and renderers.
 * Server-only: the texts are large; client code imports `./names` instead.
 */
import go from "./ignores/Go.txt?raw";
import java from "./ignores/Java.txt?raw";
import macOS from "./ignores/macOS.txt?raw";
import node from "./ignores/Node.txt?raw";
import python from "./ignores/Python.txt?raw";
import rust from "./ignores/Rust.txt?raw";
import agpl30 from "./licenses/agpl-3.0.txt?raw";
import apache20 from "./licenses/apache-2.0.txt?raw";
import bsd3Clause from "./licenses/bsd-3-clause.txt?raw";
import gpl30 from "./licenses/gpl-3.0.txt?raw";
import mit from "./licenses/mit.txt?raw";
import type { GitignoreTemplateName, LicenseTemplateKey } from "./names";

export * from "./names";

export const GITIGNORE_TEMPLATES: Record<GitignoreTemplateName, string> = {
	Node: node,
	Python: python,
	Go: go,
	Rust: rust,
	Java: java,
	macOS: macOS,
};

const LICENSE_TEXTS: Record<LicenseTemplateKey, string> = {
	mit,
	"apache-2.0": apache20,
	"gpl-3.0": gpl30,
	"agpl-3.0": agpl30,
	"bsd-3-clause": bsd3Clause,
};

/**
 * The license text. Like GitHub, only the `[year] [fullname]` placeholders
 * (MIT, BSD-3-Clause) are filled; the Apache and GPL texts keep their
 * appendix boilerplate verbatim.
 */
export function renderLicense(
	key: LicenseTemplateKey,
	holder: { year: number; fullname: string },
): string {
	return LICENSE_TEXTS[key]
		.replaceAll("[year]", String(holder.year))
		.replaceAll("[fullname]", holder.fullname);
}

/** `# name`, a blank line and the description, as GitHub's auto_init README. */
export function renderReadme(
	name: string,
	description?: string | null,
): string {
	return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}
