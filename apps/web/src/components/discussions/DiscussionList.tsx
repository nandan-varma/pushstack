import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { CategoryChip } from "@/components/discussions/CategoryChip";
import {
	SignInButton,
	ThreadList,
	ThreadRow,
} from "@/components/thread-list/ThreadList";
import { buttonVariants } from "@/components/ui/button";
import type { DiscussionView } from "@/server/discussions";

/** `/{owner}/{repo}/discussions`: categories as filters, newest activity first. */
export function DiscussionList({
	owner,
	name,
	category,
	categories,
	discussions,
	isLoading,
	signedIn,
}: {
	owner: string;
	name: string;
	category?: string;
	categories: { slug: string; name: string; emoji: string }[];
	discussions: DiscussionView[] | undefined;
	isLoading: boolean;
	signedIn: boolean;
}) {
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Link
					to="/$owner/$name/discussions"
					params={{ owner, name }}
					search={{ category: undefined }}
					className={
						category
							? "rounded-full border border-bjork-border px-2.5 py-1 text-xs text-bjork-text-soft hover:bg-bjork-surface-hover"
							: "rounded-full border border-bjork-accent bg-bjork-accent-soft px-2.5 py-1 text-xs font-medium text-bjork-accent"
					}
				>
					All
				</Link>
				{categories.map((item) => (
					<CategoryChip
						key={item.slug}
						owner={owner}
						name={name}
						category={item}
						active={item.slug === category}
					/>
				))}
				<div className="ml-auto">
					{signedIn ? (
						<Link
							to="/$owner/$name/discussions/new"
							params={{ owner, name }}
							className={buttonVariants()}
						>
							New discussion
						</Link>
					) : (
						<SignInButton>Sign in to start a discussion</SignInButton>
					)}
				</div>
			</div>
			<ThreadList
				threads={discussions}
				isLoading={isLoading}
				emptyIcon={<MessagesSquare />}
				emptyMessage="No discussions yet."
				emptyAction={
					signedIn ? (
						<Link
							to="/$owner/$name/discussions/new"
							params={{ owner, name }}
							className={buttonVariants()}
						>
							Start a discussion
						</Link>
					) : (
						<SignInButton>Sign in to start a discussion</SignInButton>
					)
				}
			>
				{(discussion) => (
					<ThreadRow
						kind="discussion"
						owner={owner}
						name={name}
						thread={discussion}
					>
						<span>
							{discussion.category.emoji} {discussion.category.name}
						</span>
						<span>
							{discussion.commentsCount} comments · {discussion.upvoteCount}{" "}
							upvotes
						</span>
						{discussion.isAnswered && (
							<span className="text-success">Answered</span>
						)}
					</ThreadRow>
				)}
			</ThreadList>
		</>
	);
}
