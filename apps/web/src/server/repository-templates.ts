import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readInput } from "./read-input";
import { readWithAccess } from "./repo-access";
import { loadRepositoryTemplates } from "./repository-templates-store";

export const getRepositoryTemplates = createServerFn({ method: "GET" })
	.validator(readInput(z.object({ repoId: z.number().int().positive() })))
	.handler(({ data }) =>
		readWithAccess(
			"getRepositoryTemplates",
			data.repoId,
			loadRepositoryTemplates,
		),
	);
