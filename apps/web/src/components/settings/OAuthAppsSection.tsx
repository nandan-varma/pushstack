import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { oauthAppsQueryOptions, queryKeys } from "@/lib/query-options";
import { registerOAuthApp, removeOAuthApp } from "@/server/oauth-apps";

interface Registered {
	clientId: string;
	clientSecret: string;
}

/** OAuth apps a user registered: create one (its secret shown once), list, delete. */
export function OAuthAppsSection() {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [callbackUrl, setCallbackUrl] = useState("");
	const [registered, setRegistered] = useState<Registered | null>(null);

	const { data: apps = [], isLoading } = useQuery(oauthAppsQueryOptions());
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.oauthApps });

	const register = useMutation({
		mutationFn: () =>
			registerOAuthApp({
				data: { name: name.trim(), callbackUrl: callbackUrl.trim() },
			}),
		onSuccess: ({ clientId, clientSecret }) => {
			setRegistered({ clientId, clientSecret });
			setName("");
			setCallbackUrl("");
			invalidate();
		},
	});
	const remove = useMutation({
		mutationFn: (id: number) => removeOAuthApp({ data: { id } }),
		onSuccess: invalidate,
	});

	return (
		<Section
			id="oauth-apps"
			title="OAuth apps"
			description="Register an app to let it sign in with PushStack. Its client secret is shown once."
		>
			<div className="space-y-4">
				{registered && (
					<div className="space-y-2 rounded-lg border border-success-border bg-success-soft p-3">
						<p className="text-sm font-medium text-foreground">
							Copy the client secret now. It won't be shown again.
						</p>
						<p className="font-mono text-xs text-muted-foreground">
							Client ID: {registered.clientId}
						</p>
						<Input
							readOnly
							value={registered.clientSecret}
							className="font-mono text-xs"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<Button variant="outline" onClick={() => setRegistered(null)}>
							Done
						</Button>
					</div>
				)}

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
									<p className="truncate text-xs text-muted-foreground">
										{app.clientId} · {app.callbackUrl} · registered{" "}
										{formatDistanceToNow(new Date(app.createdAt), {
											addSuffix: true,
										})}
									</p>
								</div>
								<Button
									variant="outline"
									disabled={remove.isPending}
									onClick={() => remove.mutate(app.id)}
								>
									Delete
								</Button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No OAuth apps yet.</p>
				)}
				<ErrorAlert message={remove.error?.message ?? ""} />

				<div className="space-y-3">
					<FormField label="Application name" htmlFor="oauth-app-name">
						<Input
							id="oauth-app-name"
							placeholder="e.g. My CI bot"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</FormField>
					<FormField
						label="Authorization callback URL"
						htmlFor="oauth-app-callback"
					>
						<Input
							id="oauth-app-callback"
							placeholder="https://example.com/callback"
							value={callbackUrl}
							onChange={(event) => setCallbackUrl(event.target.value)}
						/>
					</FormField>
					<LoadingButton
						isLoading={register.isPending}
						loadingLabel="Registering…"
						disabled={!name.trim() || !callbackUrl.trim()}
						onClick={() => register.mutate()}
					>
						Register application
					</LoadingButton>
					<ErrorAlert message={register.error?.message ?? ""} />
				</div>
			</div>
		</Section>
	);
}
