import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { authorizedAppsQueryOptions, queryKeys } from "@/lib/query-options";
import { TOKEN_SCOPE_LABELS } from "@/lib/token-scopes";
import { revokeAuthorizedApps } from "@/server/oauth-apps";

/** OAuth apps the user authorized, with revocation: every token the app holds goes. */
export function AuthorizedAppsSection() {
	const queryClient = useQueryClient();
	const { data: apps = [], isLoading } = useQuery(authorizedAppsQueryOptions());
	const revoke = useMutation({
		mutationFn: (appId: number) => revokeAuthorizedApps({ data: { appId } }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.authorizedApps }),
	});

	return (
		<Section
			id="applications"
			title="Authorized OAuth apps"
			description="Apps that signed in with your account. Revoking one signs it out everywhere."
		>
			<div className="space-y-4">
				{isLoading ? (
					<div className="h-11 animate-pulse rounded-lg border border-border bg-muted" />
				) : apps.length > 0 ? (
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
						{apps.map((app) => (
							<li
								key={app.id}
								className="flex items-center justify-between gap-3 px-4 py-3.5"
							>
								<div className="min-w-0 space-y-0.5">
									<p className="truncate text-sm font-medium text-foreground">
										{app.name}
									</p>
									<p className="text-xs text-muted-foreground">
										{app.scopes
											.map((scope) => TOKEN_SCOPE_LABELS[scope])
											.join(", ") || "No repository access"}{" "}
										· authorized{" "}
										{formatDistanceToNow(new Date(app.authorizedAt), {
											addSuffix: true,
										})}
									</p>
								</div>
								<Button
									variant="outline"
									disabled={revoke.isPending}
									onClick={() => revoke.mutate(app.id)}
								>
									Revoke
								</Button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						No OAuth apps have access to your account.
					</p>
				)}
				<ErrorAlert message={revoke.error?.message ?? ""} />
			</div>
		</Section>
	);
}
