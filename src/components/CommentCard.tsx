import { formatDistanceToNow } from "date-fns";
import { Pencil, Quote, Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getInitials } from "@/lib/utils/avatar";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

/**
 * A comment, or an issue's or pull request's description (`body` may then be
 * empty, and `allowEmpty` lets an edit clear it). Shows GitHub's "edited"
 * marker; with `onSave` the viewer can edit it in place, with `onDelete`
 * remove it.
 */
export function CommentCard({
	comment,
	owner,
	name,
	repoId,
	onQuote,
	onSave,
	onDelete,
	isSaving,
	allowEmpty,
}: {
	comment: {
		id: number;
		body: string | null;
		createdAt: string | Date;
		editedAt?: string | Date | null;
		author: { name: string; image: string | null };
	};
	owner: string;
	name: string;
	repoId?: number;
	/** Shows "Quote reply"; receives the body to quote into the reply box. */
	onQuote?: (body: string) => void;
	/** Shows "Edit"; resolves when saved. Omitted when the viewer may not edit. */
	onSave?: (body: string) => Promise<unknown>;
	/** Shows "Delete". Omitted when the viewer may not delete. */
	onDelete?: () => void;
	isSaving?: boolean;
	allowEmpty?: boolean;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const body = comment.body ?? "";

	const save = async () => {
		if (draft === null) return;
		try {
			await onSave?.(draft);
			setDraft(null);
		} catch {
			// The mutation reports the failure; keep the draft.
		}
	};

	return (
		<Card className="p-6">
			<div className="flex items-start gap-4">
				<Avatar>
					<AvatarImage src={comment.author.image ?? undefined} />
					<AvatarFallback>{getInitials(comment.author.name)}</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1">
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<span className="font-medium text-foreground">
							{comment.author.name}
						</span>
						<span className="text-sm text-muted-foreground">
							{formatDistanceToNow(new Date(comment.createdAt), {
								addSuffix: true,
							})}
						</span>
						{comment.editedAt && (
							<span
								className="text-sm text-muted-foreground"
								title={new Date(comment.editedAt).toLocaleString()}
							>
								• edited
							</span>
						)}
						{draft === null && (
							<div className="ml-auto flex items-center gap-1">
								{onQuote && body && (
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => onQuote(body)}
									>
										<Quote className="size-3.5" /> Quote reply
									</Button>
								)}
								{onSave && (
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => setDraft(body)}
									>
										<Pencil className="size-3.5" /> Edit
									</Button>
								)}
								{onDelete && (
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs text-muted-foreground"
										onClick={() => {
											if (window.confirm("Delete this comment?")) onDelete();
										}}
									>
										<Trash2 className="size-3.5" /> Delete
									</Button>
								)}
							</div>
						)}
					</div>
					{draft !== null ? (
						<div className="space-y-3">
							<Textarea
								aria-label="Edit text"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								rows={6}
							/>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setDraft(null)}
								>
									Cancel
								</Button>
								<LoadingButton
									size="sm"
									onClick={save}
									disabled={!allowEmpty && !draft.trim()}
									isLoading={isSaving}
									loadingLabel="Saving…"
								>
									Save
								</LoadingButton>
							</div>
						</div>
					) : body ? (
						<Suspense fallback={<Skeleton className="h-20" />}>
							<MarkdownRenderer
								content={body}
								owner={owner}
								name={name}
								repoId={repoId}
							/>
						</Suspense>
					) : (
						<p className="text-muted-foreground italic">
							No description provided
						</p>
					)}
				</div>
			</div>
		</Card>
	);
}
