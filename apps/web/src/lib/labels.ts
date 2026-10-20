import { z } from "zod";
import { MAX_LABEL_DESCRIPTION_CHARS, MAX_LABEL_NAME_CHARS } from "./limits";

export interface LabelView {
	id: number;
	name: string;
	color: string;
	description: string | null;
}

export const DEFAULT_LABELS: ReadonlyArray<{
	name: string;
	color: string;
	description: string;
}> = [
	{ name: "bug", color: "d73a4a", description: "Something isn't working" },
	{
		name: "documentation",
		color: "0075ca",
		description: "Improvements or additions to documentation",
	},
	{
		name: "duplicate",
		color: "cfd3d7",
		description: "This issue or pull request already exists",
	},
	{
		name: "enhancement",
		color: "a2eeef",
		description: "New feature or request",
	},
	{
		name: "good first issue",
		color: "7057ff",
		description: "Good for newcomers",
	},
	{
		name: "help wanted",
		color: "008672",
		description: "Extra attention is needed",
	},
	{ name: "invalid", color: "e4e669", description: "This doesn't seem right" },
	{
		name: "question",
		color: "d876e3",
		description: "Further information is requested",
	},
	{
		name: "wontfix",
		color: "ffffff",
		description: "This will not be worked on",
	},
];

/** A 6-digit hex color, with or without `#`; normalized to lowercase without it. */
export const labelColorSchema = z
	.string()
	.trim()
	.regex(/^#?[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex value")
	.transform((value) => value.replace(/^#/, "").toLowerCase());

export const labelNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(MAX_LABEL_NAME_CHARS);

export const labelDescriptionSchema = z
	.string()
	.trim()
	.max(MAX_LABEL_DESCRIPTION_CHARS);

// Client components import this from `label-color.ts`: this module builds zod
// schemas at load, which would pull zod into the browser bundle.
export { labelTextColor } from "#/lib/label-color";
