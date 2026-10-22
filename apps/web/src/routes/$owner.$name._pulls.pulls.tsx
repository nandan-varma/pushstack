import { createFileRoute } from "@tanstack/react-router";

/** `/{owner}/{repo}/pulls`: the list alone (its layout renders it). */
export const Route = createFileRoute("/$owner/$name/_pulls/pulls")({
	component: () => null,
});
