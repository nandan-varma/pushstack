import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/layout/panel";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BODY_CHARS, MAX_THREAD_TITLE_CHARS } from "@/lib/limits";
import { createDiscussion } from "@/server/discussions";

/** `/{owner}/{repo}/discussions/new`: title, body and a category. */
export function DiscussionComposer({
	owner,
	name,
	repoId,
	categories,
	canWrite,
}: {
	owner: string;
	name: string;
	repoId: number;
	categories: { id: number; name: string; format: string }[];
	canWrite: boolean;
}) {
	const navigate = useNavigate();
	const { toast } = useToast();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	// Announcements are maintainers' alone; their category is not offered.
	const offered = categories.filter(
		(category) => canWrite || category.format !== "announcement",
	);
	const [categoryId, setCategoryId] = useState(offered[0]?.id ?? 0);
	const mutation = useMutation({
		mutationFn: createDiscussion,
		onSuccess: ({ number }) =>
			navigate({
				to: "/$owner/$name/discussions/$id",
				params: { owner, name, id: String(number) },
				replace: true,
			}),
		onError: (error: Error) =>
			toast(error.message || "Couldn't create the discussion", "error"),
	});

	return (
		<Panel className="space-y-4 p-5">
			<div className="space-y-1.5">
				<Label htmlFor="discussion-title">Title</Label>
				<Input
					id="discussion-title"
					value={title}
					maxLength={MAX_THREAD_TITLE_CHARS}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Title"
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="discussion-category">Category</Label>
				<Select
					value={String(categoryId)}
					onValueChange={(value) => setCategoryId(Number(value))}
				>
					<SelectTrigger id="discussion-category">
						<SelectValue placeholder="Choose a category" />
					</SelectTrigger>
					<SelectContent>
						{offered.map((category) => (
							<SelectItem key={category.id} value={String(category.id)}>
								{category.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="discussion-body">Body</Label>
				<Textarea
					id="discussion-body"
					value={body}
					maxLength={MAX_BODY_CHARS}
					onChange={(event) => setBody(event.target.value)}
					rows={10}
					placeholder="What would you like to discuss?"
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button
					variant="outline"
					onClick={() =>
						navigate({
							to: "/$owner/$name/discussions",
							params: { owner, name },
						})
					}
				>
					Cancel
				</Button>
				<LoadingButton
					isLoading={mutation.isPending}
					loadingLabel="Creating…"
					disabled={!title.trim() || categoryId === 0}
					onClick={() =>
						mutation.mutate({
							data: { repoId, categoryId, title, body },
						})
					}
				>
					Start discussion
				</LoadingButton>
			</div>
		</Panel>
	);
}
