import { formatDistanceToNow } from "date-fns";
import { lazy, Suspense } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/utils/avatar";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

export function CommentCard({
	comment,
	owner,
	name,
	repoId,
}: {
	comment: {
		id: number;
		body: string;
		createdAt: string | Date;
		author?: { name?: string | null; image?: string | null } | null;
	};
	owner: string;
	name: string;
	repoId?: number;
}) {
	return (
		<Card className="p-6">
			<div className="flex items-start gap-4">
				<Avatar>
					<AvatarImage src={comment.author?.image || undefined} />
					<AvatarFallback>
						{getInitials(comment.author?.name || "U")}
					</AvatarFallback>
				</Avatar>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-4">
						<span className="font-medium text-[var(--sea-ink)]">
							{comment.author?.name || "Unknown"}
						</span>
						<span className="text-sm text-[var(--sea-ink-soft)]">
							{formatDistanceToNow(new Date(comment.createdAt), {
								addSuffix: true,
							})}
						</span>
					</div>
					<Suspense fallback={<Skeleton className="h-20" />}>
						<MarkdownRenderer
							content={comment.body}
							owner={owner}
							name={name}
							repoId={repoId}
						/>
					</Suspense>
				</div>
			</div>
		</Card>
	);
}
