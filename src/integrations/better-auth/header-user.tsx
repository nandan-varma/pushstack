import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";

export default function BetterAuthHeader() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useQuery(authSessionQueryOptions());
	const [signingOut, setSigningOut] = useState(false);

	if (isPending) {
		return <Skeleton className="h-8 w-8 rounded-full" />;
	}

	if (session?.user) {
		return (
			<div className="flex items-center gap-2.5">
				<Link
					to="/dashboard"
					className="flex items-center gap-2 rounded-full no-underline transition hover:opacity-80"
				>
					{session.user.image ? (
						<img
							src={session.user.image}
							alt=""
							className="h-8 w-8 rounded-full ring-1 ring-[var(--line)]"
						/>
					) : (
						<div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--lagoon),var(--palm))]">
							<span className="text-xs font-semibold text-white">
								{session.user.name?.charAt(0).toUpperCase() || "U"}
							</span>
						</div>
					)}
					<span className="hidden text-sm font-medium text-[var(--sea-ink)] sm:block">
						{session.user.username || session.user.name}
					</span>
				</Link>
				<Link
					to="/settings"
					className="inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon-deep)] hover:text-[var(--sea-ink)]"
				>
					Settings
				</Link>
				<button
					type="button"
					disabled={signingOut}
					onClick={async () => {
						setSigningOut(true);
						await authClient.signOut({
							fetchOptions: {
								onSuccess: async () => {
									await queryClient.invalidateQueries({
										queryKey: queryKeys.authSession,
									});
									router.navigate({ to: "/" });
								},
							},
						});
						setSigningOut(false);
					}}
					className="inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon-deep)] hover:text-[var(--sea-ink)] disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{signingOut ? "Signing out…" : "Sign out"}
				</button>
			</div>
		);
	}

	return (
		<Link
			to="/auth/login"
			className="inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--sea-ink)] no-underline transition hover:border-[var(--lagoon-deep)]"
		>
			Sign in
		</Link>
	);
}
