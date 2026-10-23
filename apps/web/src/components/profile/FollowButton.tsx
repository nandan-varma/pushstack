import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { useOptimisticUpdate } from "@/hooks/use-optimistic-update";
import { authSessionQueryOptions, queryKeys } from "@/lib/query-options";
import { setFollowing } from "@/server/follows";

interface ProfileFollow {
	isFollowing: boolean;
	followers: number;
}

/** Follow / Unfollow on someone else's profile, optimistic on the cached profile. */
export function FollowButton({
	username,
	following,
}: {
	username: string;
	following: boolean;
}) {
	const { data: session } = useQuery(authSessionQueryOptions());
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const profileKey = queryKeys.userProfile(username);

	const mutation = useMutation({
		mutationFn: setFollowing,
		...useOptimisticUpdate<ProfileFollow>(
			profileKey,
			(old, vars) => {
				if (!old) return old;
				const follow = (vars as { data: { follow: boolean } }).data.follow;
				return {
					...old,
					isFollowing: follow,
					followers: Math.max(0, old.followers + (follow ? 1 : -1)),
				};
			},
			"Failed to update follow",
		),
		onSettled: () => queryClient.invalidateQueries({ queryKey: profileKey }),
	});

	return (
		<Button
			type="button"
			variant={following ? "outline" : "default"}
			size="sm"
			className="mt-4 lg:w-full"
			aria-pressed={following}
			disabled={mutation.isPending}
			onClick={() =>
				session
					? mutation.mutate({ data: { username, follow: !following } })
					: toast("Sign in to follow people", "info")
			}
		>
			{following ? "Unfollow" : "Follow"}
		</Button>
	);
}
