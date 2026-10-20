import { createFileRoute, redirect } from "@tanstack/react-router";

// Temporary: the REST API's html_url fields still point at /repo/{owner}/{name}/…
// until its serializers move to GitHub's /{owner}/{name}/… shape.
export const Route = createFileRoute("/repo/$")({
	beforeLoad: ({ params, location }) => {
		throw redirect({
			href: `/${params._splat ?? ""}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
			statusCode: 301,
		});
	},
});
