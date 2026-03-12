import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";

export default function BetterAuthHeader() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useQuery(authSessionQueryOptions());

	if (isPending) {
		return (
			<div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
		);
	}

	if (session?.user) {
		return (
			<div className="flex items-center gap-3">
				<Link
					to="/dashboard"
					className="flex items-center gap-2 hover:opacity-80 transition-opacity"
				>
					{session.user.image ? (
						<img
							src={session.user.image}
							alt=""
							className="h-8 w-8 rounded-full"
						/>
					) : (
						<div className="h-8 w-8 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
							<span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
								{session.user.name?.charAt(0).toUpperCase() || "U"}
							</span>
						</div>
					)}
					<span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
						{session.user.username || session.user.name}
					</span>
				</Link>
				<button
					type="button"
					onClick={async () => {
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
					}}
					className="h-9 px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
				>
					Sign out
				</button>
			</div>
		);
	}

	return (
		<Link
			to="/auth/login"
			className="h-9 px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors inline-flex items-center"
		>
			Sign in
		</Link>
	);
}
