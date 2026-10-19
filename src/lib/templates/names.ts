/**
 * The template choices, without their texts, so the new-repository form can
 * list them without bundling the (server-only) license and .gitignore bodies.
 * Values match GitHub's REST `gitignore_template` and `license_template`.
 */
export const GITIGNORE_TEMPLATE_NAMES = [
	"Node",
	"Python",
	"Go",
	"Rust",
	"Java",
	"macOS",
] as const;

export type GitignoreTemplateName = (typeof GITIGNORE_TEMPLATE_NAMES)[number];

export const LICENSE_TEMPLATE_LABELS = {
	mit: "MIT License",
	"apache-2.0": "Apache License 2.0",
	"gpl-3.0": "GNU General Public License v3.0",
	"agpl-3.0": "GNU Affero General Public License v3.0",
	"bsd-3-clause": 'BSD 3-Clause "New" or "Revised" License',
} as const;

export type LicenseTemplateKey = keyof typeof LICENSE_TEMPLATE_LABELS;

export const LICENSE_TEMPLATE_KEYS = Object.keys(LICENSE_TEMPLATE_LABELS) as [
	LicenseTemplateKey,
	...LicenseTemplateKey[],
];
