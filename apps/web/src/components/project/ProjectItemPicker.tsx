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
import type { AddableProjectItem } from "@/server/project-store";

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
	results,
	onSearch,
	onAdd,
}: {
	login: string;
	number: number;
	itemCount: number;
	pending: boolean;
	results: AddableProjectItem[];
	onSearch: (query: string) => void;
	onAdd: (issueId: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const search = (next: string) => {
		setQuery(next);
		onSearch(next);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) search("");
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
						onChange={(event) => search(event.target.value)}
					/>
					{results.length === 0 ? (
						<p className="py-4 text-sm text-bjork-text-soft">
							{query
								? "No readable issue or pull request matches."
								: "Type to search issues and pull requests you can read."}
						</p>
					) : (
						<ul className="max-h-72 space-y-1 overflow-y-auto">
							{results.map((item) => (
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
