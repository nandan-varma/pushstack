import { inputs } from "@pushstack/api-contract";
import { z } from "zod";
import { MAX_LABEL_DESCRIPTION_CHARS } from "./limits";

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

export const labelColorSchema = inputs.labelColor;

export const labelNameSchema = inputs.labelName;

export const labelDescriptionSchema = z
	.string()
	.trim()
	.max(MAX_LABEL_DESCRIPTION_CHARS);
