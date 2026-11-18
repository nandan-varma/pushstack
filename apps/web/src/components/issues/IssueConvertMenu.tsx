import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	discussionCategoriesQueryOptions,
	queryKeys,
} from "@/lib/query-options";
import { convertIssueToDiscussion } from "@/server/issues";

/** GitHub's issue menu entry: convert an issue into a discussion in a category. */
export function IssueConvertMenu({
	owner,
	name,
	repoId,
	issueId,
	issueNumber,
}: {
	owner: string;
	name: string;
	repoId: number;
	issueId: number;
	issueNumber: number;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();
	const { data: categories } = useQuery(
		discussionCategoriesQueryOptions(repoId),
	);
	const convert = useMutation({
		mutationFn: convertIssueToDiscussion,
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoIssuesRoot(repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.repoDiscussionsRoot(repoId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.discussionByNumber(owner, name, issueNumber),
				}),
			]);
			await navigate({
				to: "/$owner/$name/discussions/$id",
				params: { owner, name, id: String(issueNumber) },
			});
		},
		onError: (error: Error) =>
			toast(error.message || "Couldn't convert the issue", "error"),
	});

	if (!categories || categories.length === 0) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon" aria-label="Issue actions">
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuSub>
					<DropdownMenuSubTrigger disabled={convert.isPending}>
						<MessageSquare />
						Convert to discussion
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-56">
						{categories.map((category) => (
							<DropdownMenuItem
								key={category.id}
								onClick={() =>
									convert.mutate({
										data: { issueId, categoryId: category.id },
									})
								}
							>
								{category.emoji} {category.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
