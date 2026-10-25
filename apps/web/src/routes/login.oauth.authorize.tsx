import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthFormShell } from "@/components/auth-form-shell";
import { ErrorAlert } from "@/components/ui/error-alert";
import { LoadingButton } from "@/components/ui/loading-button";
import { authSessionQueryOptions } from "@/lib/query-options";
import { TOKEN_SCOPE_LABELS } from "@/lib/token-scopes";
import {
	decideAuthorization,
	getAuthorizationRequest,
} from "@/server/oauth-apps";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * GET /login/oauth/authorize: the consent page an OAuth app sends the user to.
 * The request is checked on the server before anything is shown: an unknown
 * client, or a redirect URI that is not the registered one, is an error here
 * and the user is not sent anywhere.
 */
export const Route = createFileRoute("/login/oauth/authorize")({
	validateSearch: (search: Record<string, unknown>) => ({
		client_id: text(search.client_id),
		redirect_uri: text(search.redirect_uri),
		scope: text(search.scope),
		state: text(search.state),
	}),
	beforeLoad: async ({ context: { queryClient }, location }) => {
		const session = await queryClient.ensureQueryData(
			authSessionQueryOptions(),
		);
		if (!session?.user) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
	},
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => getAuthorizationRequest({ data: deps }),
	component: AuthorizePage,
});

const REQUEST_ERRORS = {
	unknown_client: "This application is not registered with PushStack.",
	redirect_uri_mismatch:
		"The redirect URI does not match the one this application registered, so the request cannot continue.",
} as const;

function AuthorizePage() {
	const params = Route.useSearch();
	const request = Route.useLoaderData();
	const decide = useMutation({
		mutationFn: (approve: boolean) =>
			decideAuthorization({ data: { ...params, approve } }),
		onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
	});

	if (!request.ok) {
		return (
			<AuthFormShell title="Authorization request">
				<ErrorAlert message={REQUEST_ERRORS[request.error]} />
			</AuthFormShell>
		);
	}

	return (
		<AuthFormShell
			title={`Authorize ${request.app.name}`}
			subtitle={`Authorizing will redirect to ${new URL(request.app.callbackUrl).host}.`}
		>
			<p className="text-sm text-bjork-text">
				This application asks for access to your account with:
			</p>
			<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-bjork-text-muted">
				{request.scopes.map((scope) => (
					<li key={scope}>{TOKEN_SCOPE_LABELS[scope]}</li>
				))}
			</ul>
			{request.scopes.length === 0 && (
				<p className="mt-2 text-sm text-bjork-text-muted">
					It asks for no access to repositories.
				</p>
			)}
			<div className="mt-6 flex gap-3">
				<LoadingButton
					className="flex-1"
					isLoading={decide.isPending}
					loadingLabel="Authorizing…"
					onClick={() => decide.mutate(true)}
				>
					Authorize
				</LoadingButton>
				<LoadingButton
					variant="outline"
					className="flex-1"
					disabled={decide.isPending}
					onClick={() => decide.mutate(false)}
				>
					Cancel
				</LoadingButton>
			</div>
			<ErrorAlert className="mt-4" message={decide.error?.message ?? ""} />
		</AuthFormShell>
	);
}
