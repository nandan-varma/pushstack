import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { NewThreadDialog } from "@/components/thread-list/NewThreadDialog";
import { useToast } from "@/components/toast-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query-options";
import { createForkPullRequest } from "@/server/pull-requests";

/**
 * "Open PR from fork": a pull request in the fork's parent whose head is this
 * fork's branch. The base defaults to the parent's default branch, as GitHub's
 * fork compare page does.
 */
export function ForkPullRequestButton({
	repoId,
	forkOwner,
	headBranch,
	parent,
}: {
	repoId: number;
	forkOwner: string;
	headBranch: string;
	parent: {
		name: string;
		owner: { username: string };
		defaultBranch: string;
	};
}) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const mutation = useMutation({
		mutationFn: createForkPullRequest,
		onSuccess: (pr) => {
			// The pull request lives in the parent, so the parent's row (its open
			// count) is what changed; nothing in the fork's own lists did.
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(
					parent.owner.username,
					parent.name,
				),
			});
			setOpen(false);
			toast("Pull request created", "success");
			navigate({
				to: "/$owner/$name/pull/$id/{-$tab}",
				params: {
					owner: pr.owner,
					name: pr.name,
					id: String(pr.number),
				},
			});
		},
		onError: (error: Error) => {
			toast(error.message || "Failed to create pull request", "error");
		},
	});

	const target = `${parent.owner.username}/${parent.name}:${parent.defaultBranch}`;
	return (
		<NewThreadDialog
			open={open}
			onOpenChange={setOpen}
			triggerLabel="Open PR from fork"
			title="Open pull request"
			description={`Merge ${forkOwner}:${headBranch} into ${target}`}
			submitLabel="Create pull request"
			canSubmit={!!title.trim()}
			isPending={mutation.isPending}
			onSubmit={() =>
				mutation.mutate({
					data: {
						repoId,
						title,
						...(body ? { body } : {}),
						sourceBranchName: headBranch,
						targetBranchName: parent.defaultBranch,
					},
				})
			}
		>
			<div className="space-y-1.5">
				<Label htmlFor="fork-pr-title">Title</Label>
				<Input
					id="fork-pr-title"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Pull request title"
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="fork-pr-body">Description</Label>
				<Textarea
					id="fork-pr-body"
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder="Describe your changes…"
					rows={5}
				/>
			</div>
		</NewThreadDialog>
	);
}
