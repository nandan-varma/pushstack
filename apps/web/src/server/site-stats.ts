import { routes } from "@pushstack/api-contract/client";
import { createServerFn } from "@tanstack/react-start";

/** Figures the landing page quotes, read from the code rather than typed in. */
export const getSiteStats = createServerFn({ method: "GET" }).handler(() => ({
	restOperations: Object.keys(routes).length,
}));
