import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { getInitials } from "@/lib/utils/avatar";

export default function BetterAuthHeader() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useQuery(authSessionQueryOptions());
	const [signingOut, setSigningOut] = useState(false);

	if (isPending) {
		return <Skeleton className="h-8 w-8 rounded-full" />;
	}

	if (session?.user) {
		const handleSignOut = async () => {
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
		};

		return (
			<DropdownMenu>
				<DropdownMenuTrigger
					className="flex items-center gap-2 rounded-full transition hover:opacity-80"
					aria-label="Account menu"
				>
					<Avatar className="h-8 w-8 ring-1 ring-[var(--border)]">
						<AvatarImage
							src={session.user.image ?? undefined}
							alt={session.user.name || "Account"}
						/>
						<AvatarFallback className="text-xs font-semibold">
							{getInitials(session.user.name || "U")}
						</AvatarFallback>
					</Avatar>
					<span className="hidden text-sm font-medium text-foreground sm:block">
						{session.user.username || session.user.name}
					</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuLabel className="truncate font-normal text-muted-foreground">
						{session.user.email}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => router.navigate({ to: "/dashboard" })}
					>
						Dashboard
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => router.navigate({ to: "/settings" })}
					>
						Settings
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						disabled={signingOut}
						onClick={(event) => {
							event.preventDefault();
							handleSignOut();
						}}
					>
						{signingOut ? "Signing out…" : "Sign out"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return (
		<Link
			to="/auth/login"
			className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground no-underline transition hover:border-primary"
		>
			Sign in
		</Link>
	);
}
