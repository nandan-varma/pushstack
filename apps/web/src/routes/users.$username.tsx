import { createFileRoute, redirect } from "@tanstack/react-router";

// Temporary: the REST API's html_url fields still point at /users/{login}
// until its serializers move to GitHub's /{login} shape.
export const Route = createFileRoute("/users/$username")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/$owner",
			params: { owner: params.username },
			statusCode: 301,
		});
	},
});
