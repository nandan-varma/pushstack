import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiffResult } from "git-fs-s3/ops";
import {
	Check,
	ChevronDown,
	MessageSquare,
	MessageSquarePlus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { RelativeTime } from "@/components/RelativeTime";
import { useToast } from "@/components/toast-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { anchorKey, type DiffAnchor } from "@/lib/diff";
import {
	pullRequestPendingReviewQueryOptions,
	pullRequestReviewThreadsQueryOptions,
	queryKeys,
} from "@/lib/query-options";
import type {
	PullRequestReviewSummary,
	ReviewAuthor,
	ReviewCommentView,
	ReviewThread,
} from "@/lib/review-types";
import { getInitials } from "@/lib/utils/avatar";
import {
	createReviewComment,
	discardPendingReview,
	resolveReviewThread,
	submitReview,
} from "@/server/reviews";

const MarkdownRenderer = lazy(() => import("@/components/MarkdownRenderer"));

interface PullRequestFilesTabProps {
	owner: string;
	name: string;
	pr: {
		id: number;
		repoId: number;
		number: number;
		sourceBranch: string;
		targetBranch: string;
		viewer: { canParticipate: boolean };
		review: {
			summary: PullRequestReviewSummary;
			canApprove: boolean;
			canResolve: boolean;
		};
	};
	diff: DiffResult | undefined;
	diffLoading: boolean;
}

export function PullRequestFilesTab({
	owner,
	name,
	pr,
	diff,
	diffLoading,
}: PullRequestFilesTabProps) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [composingAnchor, setComposingAnchor] = useState<DiffAnchor | null>(
		null,
	);
	const [replyToId, setReplyToId] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const [summary, setSummary] = useState("");

	const { data: threads = [] } = useQuery(
		pullRequestReviewThreadsQueryOptions(pr.id),
	);
	const { data: pendingReview } = useQuery(
		pullRequestPendingReviewQueryOptions(pr.id),
	);

	const refresh = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.pullRequestReviewThreads(pr.id),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.pullRequestPendingReview(pr.id),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.timelineRoot(pr.repoId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.pullRequestByNumber(owner, name, pr.number),
		});
	};

	const commentMutation = useMutation({
		mutationFn: createReviewComment,
		onSuccess: () => {
			setDraft("");
			setComposingAnchor(null);
			setReplyToId(null);
			refresh();
			toast("Added to your pending review", "success");
		},
		onError: (error: Error) =>
			toast(error.message || "Failed to add the comment", "error"),
	});
	const submitMutation = useMutation({
		mutationFn: submitReview,
		onSuccess: () => {
			setSummary("");
			refresh();
			toast("Review submitted", "success");
		},
		onError: (error: Error) =>
			toast(error.message || "Failed to submit the review", "error"),
	});
	const discardMutation = useMutation({
		mutationFn: discardPendingReview,
		onSuccess: () => {
			refresh();
			toast("Pending review discarded", "success");
		},
		onError: (error: Error) =>
			toast(error.message || "Failed to discard the review", "error"),
	});
	const resolveMutation = useMutation({
		mutationFn: resolveReviewThread,
		onSuccess: refresh,
		onError: (error: Error) =>
			toast(error.message || "Failed to update the conversation", "error"),
	});

	const threadsByAnchor = useMemo(() => {
		const map = new Map<string, ReviewThread[]>();
		for (const thread of threads) {
			const key = anchorKey(thread);
			const list = map.get(key);
			if (list) list.push(thread);
			else map.set(key, [thread]);
		}
		return map;
	}, [threads]);

	const pendingByAnchor = useMemo(() => {
		const map = new Map<string, ReviewCommentView[]>();
		for (const comment of pendingReview?.comments ?? []) {
			const key = anchorKey(comment);
			const list = map.get(key);
			if (list) list.push(comment);
			else map.set(key, [comment]);
		}
		return map;
	}, [pendingReview]);

	const handleLineSubmit = () => {
		if (!composingAnchor || !draft.trim()) return;
		commentMutation.mutate({
			data: {
				prId: pr.id,
				body: draft,
				path: composingAnchor.path,
				line: composingAnchor.line,
				side: composingAnchor.side,
			},
		});
	};

	const handleReplySubmit = (inReplyToId: number) => {
		if (!draft.trim()) return;
		commentMutation.mutate({ data: { prId: pr.id, body: draft, inReplyToId } });
	};

	const handleSubmitReview = (
		event: "comment" | "approve" | "request_changes",
	) => {
		submitMutation.mutate({
			data: {
				prId: pr.id,
				event,
				...(summary.trim() ? { body: summary } : {}),
			},
		});
	};

	const renderThreads = (anchors: DiffAnchor[]): ReactNode => {
		const cards: ReactNode[] = [];
		for (const anchor of anchors) {
			const key = anchorKey(anchor);
			for (const thread of threadsByAnchor.get(key) ?? []) {
				cards.push(
					<ReviewThreadCard
						key={`thread-${thread.id}`}
						thread={thread}
						owner={owner}
						name={name}
						repoId={pr.repoId}
						canResolve={pr.review.canResolve}
						replying={replyToId === thread.id}
						onReply={() => {
							setReplyToId(replyToId === thread.id ? null : thread.id);
							setDraft("");
						}}
						onResolve={(resolved) =>
							resolveMutation.mutate({
								data: { commentId: thread.id, resolved },
							})
						}
						draft={draft}
						onDraftChange={setDraft}
						onSubmitReply={() => handleReplySubmit(thread.id)}
						isPending={commentMutation.isPending}
					/>,
				);
			}
			const pending = pendingByAnchor.get(key);
			if (pending?.length) {
				cards.push(
					<PendingComments
						key={`pending-${key}`}
						comments={pending}
						owner={owner}
						name={name}
						repoId={pr.repoId}
					/>,
				);
			}
			if (composingAnchor && anchorKey(composingAnchor) === key) {
				cards.push(
					<Composer
						key={`composer-${key}`}
						label={`Comment on ${anchor.path}:${anchor.line}`}
						value={draft}
						onChange={setDraft}
						onSubmit={handleLineSubmit}
						onCancel={() => {
							setComposingAnchor(null);
							setDraft("");
						}}
						isPending={commentMutation.isPending}
					/>,
				);
			}
		}
		return cards.length > 0 ? <div className="space-y-2">{cards}</div> : null;
	};

	const pendingCount = pendingReview?.comments.length ?? 0;
	const reviewButton = pr.viewer.canParticipate && (
		<Popover>
			<PopoverTrigger
				render={<Button size="sm" />}
				aria-label={
					pendingCount
						? `Review changes (${pendingCount} pending)`
						: "Review changes"
				}
			>
				Review changes
				{pendingCount > 0 && (
					<span className="rounded-full bg-white/20 px-1.5 font-mono text-[11px] tabular-nums">
						{pendingCount}
					</span>
				)}
				<ChevronDown aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[min(26rem,calc(100vw-2rem))] gap-3"
			>
				<p className="text-[13px] font-semibold text-bjork-text">
					Finish your review
				</p>
				{pendingCount > 0 && (
					<p className="text-xs text-bjork-text-muted">
						{pendingCount} pending comment{pendingCount === 1 ? "" : "s"} — only
						you can see them until you submit.
					</p>
				)}
				<Textarea
					aria-label="Review summary"
					value={summary}
					onChange={(event) => setSummary(event.target.value)}
					placeholder="Leave a summary (optional)"
					rows={4}
				/>
				<div className="flex flex-wrap items-center justify-end gap-2">
					{pendingReview && (
						<Button
							variant="ghost"
							size="sm"
							className="mr-auto text-bjork-text-muted"
							disabled={discardMutation.isPending}
							onClick={() => discardMutation.mutate({ data: { prId: pr.id } })}
						>
							<Trash2 /> Discard
						</Button>
					)}
					<LoadingButton
						variant="outline"
						size="sm"
						onClick={() => handleSubmitReview("comment")}
						isLoading={submitMutation.isPending}
						loadingLabel="Submitting…"
					>
						<MessageSquare /> Comment
					</LoadingButton>
					{pr.review.canApprove && (
						<>
							<LoadingButton
								variant="destructive"
								size="sm"
								onClick={() => handleSubmitReview("request_changes")}
								isLoading={submitMutation.isPending}
								loadingLabel="Submitting…"
							>
								Request changes
							</LoadingButton>
							<LoadingButton
								size="sm"
								onClick={() => handleSubmitReview("approve")}
								isLoading={submitMutation.isPending}
								loadingLabel="Approving…"
								className="bg-success text-white hover:bg-success/90"
							>
								<Check /> Approve
							</LoadingButton>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);

	return (
		<FileDiffViewer
			files={diff?.files}
			sides={{
				owner,
				name,
				oldRef: diff?.oldRef,
				newRef: diff?.newRef ?? pr.sourceBranch,
			}}
			isLoading={diffLoading}
			emptyMessage={`No changes between ${pr.sourceBranch} and ${pr.targetBranch}.`}
			toolbarActions={reviewButton}
			renderLineActions={
				pr.viewer.canParticipate
					? (anchor) => (
							<Button
								variant="ghost"
								size="icon-xs"
								className="text-bjork-accent focus-visible:opacity-100 group-hover/line:opacity-100 [@media(hover:hover)]:opacity-0"
								aria-label={`Comment on ${anchor.path} line ${anchor.line}`}
								onClick={() => {
									setComposingAnchor(anchor);
									setReplyToId(null);
									setDraft("");
								}}
							>
								<MessageSquarePlus />
							</Button>
						)
					: undefined
			}
			renderThreads={renderThreads}
		/>
	);
}

function CommentBody({
	body,
	createdAt,
	author,
	owner,
	name,
	repoId,
}: {
	body: string;
	createdAt: Date;
	author: ReviewAuthor;
	owner: string;
	name: string;
	repoId: number;
}) {
	return (
		<div className="flex items-start gap-3">
			<Avatar className="size-7">
				<AvatarImage src={author.image ?? undefined} />
				<AvatarFallback>{getInitials(author.name)}</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1">
				<p className="text-sm">
					<span className="font-medium text-foreground">{author.name}</span>{" "}
					<span className="text-muted-foreground">
						<RelativeTime date={createdAt} />
					</span>
				</p>
				<Suspense fallback={<Skeleton className="h-12" />}>
					<MarkdownRenderer
						content={body}
						owner={owner}
						name={name}
						repoId={repoId}
					/>
				</Suspense>
			</div>
		</div>
	);
}

function ReviewThreadCard({
	thread,
	owner,
	name,
	repoId,
	canResolve,
	replying,
	onReply,
	onResolve,
	draft,
	onDraftChange,
	onSubmitReply,
	isPending,
}: {
	thread: ReviewThread;
	owner: string;
	name: string;
	repoId: number;
	canResolve: boolean;
	replying: boolean;
	onReply: () => void;
	onResolve: (resolved: boolean) => void;
	draft: string;
	onDraftChange: (value: string) => void;
	onSubmitReply: () => void;
	isPending: boolean;
}) {
	return (
		<Card className="gap-3 p-4">
			<div className="flex items-center justify-between gap-2">
				<Badge variant={thread.resolved ? "secondary" : "outline"}>
					{thread.resolved
						? "Resolved"
						: `${thread.path}:${thread.line} (${thread.side === "RIGHT" ? "new" : "old"})`}
				</Badge>
				{canResolve && (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-muted-foreground"
						onClick={() => onResolve(!thread.resolved)}
					>
						{thread.resolved ? (
							<>
								<RotateCcw className="size-3.5" /> Unresolve
							</>
						) : (
							<>
								<Check className="size-3.5" /> Resolve conversation
							</>
						)}
					</Button>
				)}
			</div>
			<div className="space-y-3">
				{thread.comments.map((comment) => (
					<CommentBody
						key={comment.id}
						body={comment.body}
						createdAt={comment.createdAt}
						author={comment.author}
						owner={owner}
						name={name}
						repoId={repoId}
					/>
				))}
			</div>
			{!thread.resolved &&
				(replying ? (
					<Composer
						label="Reply"
						value={draft}
						onChange={onDraftChange}
						onSubmit={onSubmitReply}
						onCancel={onReply}
						isPending={isPending}
					/>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-fit text-xs text-muted-foreground"
						onClick={onReply}
					>
						<MessageSquare className="size-3.5" /> Reply
					</Button>
				))}
		</Card>
	);
}

function PendingComments({
	comments,
	owner,
	name,
	repoId,
}: {
	comments: ReviewCommentView[];
	owner: string;
	name: string;
	repoId: number;
}) {
	return (
		<Card className="gap-3 border-dashed p-4">
			<Badge variant="outline">Pending review</Badge>
			<div className="space-y-3">
				{comments.map((comment) => (
					<CommentBody
						key={comment.id}
						body={comment.body}
						createdAt={comment.createdAt}
						author={comment.author}
						owner={owner}
						name={name}
						repoId={repoId}
					/>
				))}
			</div>
		</Card>
	);
}

function Composer({
	label,
	value,
	onChange,
	onSubmit,
	onCancel,
	isPending,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	isPending: boolean;
}) {
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">{label}</p>
			<Textarea
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				rows={3}
				placeholder="Write a comment… (Markdown supported)"
			/>
			<div className="flex justify-end gap-2">
				<Button variant="outline" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<LoadingButton
					size="sm"
					onClick={onSubmit}
					disabled={!value.trim()}
					isLoading={isPending}
					loadingLabel="Posting…"
				>
					Comment
				</LoadingButton>
			</div>
		</div>
	);
}
