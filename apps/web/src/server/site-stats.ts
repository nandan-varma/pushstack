import { createServerFn } from "@tanstack/react-start";

/** Figures the landing page quotes, read from the code rather than typed in. */
export const getSiteStats = createServerFn({ method: "GET" }).handler(
	async () => {
		// Imported in the handler, not at module scope: a server-function file
		// keeps its top-level imports in the client bundle (only handler bodies
		// are stripped), and the contract's route table carries zod schemas the
		// landing page never parses.
		const { routes } = await import("@pushstack/api-contract/client");
		return { restOperations: Object.keys(routes).length };
	},
);
