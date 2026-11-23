import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_PROJECT_FILTER_CHARS, MAX_PROJECT_ITEMS } from "@/lib/limits";
import { projectAddableItemsQueryOptions } from "@/lib/query-options";

/**
 * The add-item picker: searches the issues and pull requests the viewer can
 * read and that are not in the project yet. The project's item cap is
 * enforced server-side; the picker only stops offering more.
 */
export function ProjectItemPicker({
	login,
	number,
	itemCount,
	pending,
	onAdd,
}: {
	login: string;
	number: number;
	itemCount: number;
	pending: boolean;
	onAdd: (issueId: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const { data, isFetching, isError, refetch } = useQuery({
		...projectAddableItemsQueryOptions(login, number, query),
		enabled: open,
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) setQuery("");
			}}
		>
			<DialogTrigger asChild>
				<Button disabled={itemCount >= MAX_PROJECT_ITEMS}>Add item</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						Add an item to {login}'s project #{number}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<Input
						aria-label="Search issues and pull requests"
						value={query}
						maxLength={MAX_PROJECT_FILTER_CHARS}
						placeholder="Search by title or number"
						onChange={(event) => setQuery(event.target.value)}
					/>
					{isFetching ? (
						<p role="status" className="py-4 text-sm text-bjork-text-soft">
							Searching issues and pull requests…
						</p>
					) : isError ? (
						<div role="alert" className="space-y-2 py-4">
							<p className="text-sm text-bjork-text-muted">
								Couldn’t search issues and pull requests.
							</p>
							<Button variant="outline" onClick={() => refetch()}>
								Try again
							</Button>
						</div>
					) : data?.items.length === 0 ? (
						<p className="py-4 text-sm text-bjork-text-soft">
							{query
								? "No readable issue or pull request matches."
								: "Type to search issues and pull requests you can read."}
						</p>
					) : (
						<ul className="max-h-72 space-y-1 overflow-y-auto">
							{data?.items.map((item) => (
								<li key={item.id}>
									<Button
										variant="ghost"
										className="w-full justify-start text-left"
										disabled={pending}
										onClick={() => onAdd(item.id)}
									>
										<Badge variant="outline">
											{item.kind === "pull_request" ? "Pull request" : "Issue"}
										</Badge>
										<span className="min-w-0 flex-1 truncate">
											{item.title}
										</span>
										<span className="font-mono text-xs text-bjork-text-soft">
											{item.repoOwner}/{item.repoName}#{item.number}
										</span>
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
