import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { authClient } from "@/lib/auth-client";
import { authSessionsQueryOptions, queryKeys } from "@/lib/query-options";

async function unwrap(
	result: Promise<{ error: { message?: string } | null }>,
): Promise<void> {
	const { error } = await result;
	if (error) throw new Error(error.message ?? "Request failed");
}

export function SessionsSection({ currentToken }: { currentToken: string }) {
	const queryClient = useQueryClient();
	const { data: sessions = [], isLoading } = useQuery(
		authSessionsQueryOptions(),
	);
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.authSessions });

	const revoke = useMutation({
		mutationFn: (token: string) => unwrap(authClient.revokeSession({ token })),
		onSuccess: invalidate,
	});
	const revokeOthers = useMutation({
		mutationFn: () => unwrap(authClient.revokeOtherSessions()),
		onSuccess: invalidate,
	});

	const others = sessions.filter((s) => s.token !== currentToken);

	return (
		<Section
			title="Sessions"
			description="Browsers and devices signed in to your account."
		>
			<div className="space-y-4">
				{isLoading ? (
					<div className="h-11 animate-pulse rounded-lg border border-border bg-muted" />
				) : (
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
						{sessions.map((s) => {
							const current = s.token === currentToken;
							return (
								<li
									key={s.id}
									className="flex items-center justify-between gap-3 px-4 py-3"
								>
									<div className="min-w-0 space-y-0.5">
										<p className="truncate text-sm font-medium text-foreground">
											{s.userAgent || "Unknown device"}
										</p>
										<p className="text-xs text-muted-foreground">
											{current ? "This session · " : ""}
											{s.ipAddress ? `${s.ipAddress} · ` : ""}
											signed in{" "}
											{formatDistanceToNow(new Date(s.createdAt), {
												addSuffix: true,
											})}
										</p>
									</div>
									{!current && (
										<Button
											variant="outline"
											size="sm"
											disabled={revoke.isPending}
											onClick={() => revoke.mutate(s.token)}
										>
											Sign out
										</Button>
									)}
								</li>
							);
						})}
					</ul>
				)}
				{others.length > 0 && (
					<LoadingButton
						variant="outline"
						isLoading={revokeOthers.isPending}
						loadingLabel="Signing out…"
						onClick={() => revokeOthers.mutate()}
					>
						Sign out all other sessions
					</LoadingButton>
				)}
				{(revoke.error || revokeOthers.error) && (
					<p className="text-sm text-red-600 dark:text-red-400">
						{(revoke.error ?? revokeOthers.error)?.message}
					</p>
				)}
			</div>
		</Section>
	);
}
