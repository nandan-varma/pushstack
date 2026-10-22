import { formatDistanceToNow } from "date-fns";
import { Ellipsis, Pencil, Quote, Trash2 } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getInitials } from "@/lib/utils/avatar";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

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
	footer,
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
	onQuote?: (body: string) => void;
	onSave?: (body: string) => Promise<unknown>;
	onDelete?: () => void;
	isSaving?: boolean;
	allowEmpty?: boolean;
	/** Rendered under the body, e.g. the reaction row. */
	footer?: ReactNode;
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

	const hasActions =
		draft === null && ((onQuote && body) || onSave || onDelete);
	const createdAt = new Date(comment.createdAt);

	return (
		<Panel>
			<div className="flex min-h-11 items-center gap-2.5 border-b border-bjork-border-muted bg-bjork-surface-muted py-1.5 pr-2 pl-4 text-sm">
				<Avatar size="sm">
					<AvatarImage src={comment.author.image ?? undefined} />
					<AvatarFallback className="text-[11px]">
						{getInitials(comment.author.name)}
					</AvatarFallback>
				</Avatar>
				<p className="min-w-0 flex-1 truncate text-bjork-text-soft">
					<span className="font-semibold text-bjork-text">
						{comment.author.name}
					</span>{" "}
					commented{" "}
					<time
						dateTime={createdAt.toISOString()}
						title={createdAt.toLocaleString()}
					>
						{formatDistanceToNow(createdAt, { addSuffix: true })}
					</time>
					{comment.editedAt && (
						<span title={new Date(comment.editedAt).toLocaleString()}>
							{" "}
							· edited
						</span>
					)}
				</p>
				{hasActions && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Comment actions"
								className="text-bjork-text-soft"
							>
								<Ellipsis />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							{onQuote && body && (
								<DropdownMenuItem onClick={() => onQuote(body)}>
									<Quote /> Quote reply
								</DropdownMenuItem>
							)}
							{onSave && (
								<DropdownMenuItem onClick={() => setDraft(body)}>
									<Pencil /> Edit
								</DropdownMenuItem>
							)}
							{onDelete && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onClick={() => {
											if (window.confirm("Delete this comment?")) onDelete();
										}}
									>
										<Trash2 /> Delete
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			<div className="px-5 py-4">
				{draft !== null ? (
					<div className="space-y-3">
						<Textarea
							aria-label="Edit text"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={6}
						/>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setDraft(null)}>
								Cancel
							</Button>
							<LoadingButton
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
					<p className="text-sm text-bjork-text-soft italic">
						No description provided.
					</p>
				)}
				{draft === null && footer && <div className="mt-4">{footer}</div>}
			</div>
		</Panel>
	);
}
