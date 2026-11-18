import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Lock,
	LockOpen,
	MessageSquare,
	MoreHorizontal,
	Pin,
	PinOff,
} from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryKeys } from "@/lib/query-options";
import type { DiscussionView } from "@/server/discussions";
import {
	convertDiscussionToIssue,
	lockDiscussion,
	pinDiscussion,
} from "@/server/discussions";

/** GitHub's discussion menu: lock, pin and convert, for write collaborators. */
export function DiscussionMenu({
	owner,
	name,
	discussion,
}: {
	owner: string;
	name: string;
	discussion: DiscussionView;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();
	const refresh = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.discussionByNumber(owner, name, discussion.number),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.repoDiscussionsRoot(discussion.repoId),
		});
	};
	const onError = (error: Error) =>
		toast(error.message || "Couldn't update the discussion", "error");
	const lock = useMutation({
		mutationFn: lockDiscussion,
		onSuccess: refresh,
		onError,
	});
	const pin = useMutation({
		mutationFn: pinDiscussion,
		onSuccess: refresh,
		onError,
	});
	const convert = useMutation({
		mutationFn: convertDiscussionToIssue,
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoDiscussionsRoot(discussion.repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.issueByNumber(owner, name, discussion.number),
				}),
			]);
			await navigate({
				to: "/$owner/$name/issues/$id",
				params: { owner, name, id: String(discussion.number) },
			});
		},
		onError,
	});

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon" aria-label="Discussion actions">
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuItem
					disabled={lock.isPending}
					onClick={() =>
						lock.mutate({
							data: { discussionId: discussion.id, locked: !discussion.locked },
						})
					}
				>
					{discussion.locked ? <LockOpen /> : <Lock />}
					{discussion.locked ? "Unlock conversation" : "Lock conversation"}
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={pin.isPending}
					onClick={() =>
						pin.mutate({
							data: {
								discussionId: discussion.id,
								pinned: discussion.pinnedAt === null,
							},
						})
					}
				>
					{discussion.pinnedAt === null ? <Pin /> : <PinOff />}
					{discussion.pinnedAt === null ? "Pin discussion" : "Unpin discussion"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={convert.isPending}
					onClick={() =>
						convert.mutate({ data: { discussionId: discussion.id } })
					}
				>
					<MessageSquare />
					Convert to issue
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
