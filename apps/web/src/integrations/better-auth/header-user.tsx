import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
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

/**
 * The sidebar's account row: who is signed in, with profile, settings and
 * sign-out one menu away; or the two ways in for a visitor.
 */
export default function AccountMenu() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useQuery(authSessionQueryOptions());
	const [signingOut, setSigningOut] = useState(false);

	if (isPending) {
		return <Skeleton className="h-11 w-full rounded-[12px]" />;
	}

	if (!session?.user) {
		return (
			<div className="grid grid-cols-2 gap-2">
				<Link
					to="/auth/login"
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Sign in
				</Link>
				<Link to="/auth/register" className={buttonVariants({ size: "sm" })}>
					Sign up
				</Link>
			</div>
		);
	}

	const user = session.user;
	const username = user.username || user.name;
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
				className="flex h-11 w-full items-center gap-2.5 rounded-[12px] px-2 text-left transition-[background-color] duration-150 hover:bg-bjork-surface-hover aria-expanded:bg-bjork-surface-active"
				aria-label="Account menu"
			>
				<Avatar size="sm">
					<AvatarImage src={user.image ?? undefined} alt="" />
					<AvatarFallback className="text-[11px]">
						{getInitials(user.name || "U")}
					</AvatarFallback>
				</Avatar>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-bjork-text">
						{user.name}
					</span>
					<span className="block truncate text-xs text-bjork-text-soft">
						@{username}
					</span>
				</span>
				<ChevronsUpDown
					aria-hidden="true"
					className="size-4 shrink-0 text-bjork-text-soft"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="w-56">
				<DropdownMenuLabel className="truncate normal-case tracking-normal">
					{user.email}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() =>
						router.navigate({ to: "/$owner", params: { owner: username } })
					}
				>
					<User /> Your profile
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => router.navigate({ to: "/settings" })}>
					<Settings /> Settings
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={signingOut}
					onClick={(event) => {
						event.preventDefault();
						handleSignOut();
					}}
				>
					<LogOut /> {signingOut ? "Signing out…" : "Sign out"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
