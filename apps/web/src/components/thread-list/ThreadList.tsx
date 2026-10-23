import { Link } from "@tanstack/react-router";
import {
	CircleCheck,
	CircleDot,
	CircleX,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LabelChip } from "@/components/LabelChip";
import { Panel, PanelHeader } from "@/components/layout/panel";
import { RelativeTime } from "@/components/RelativeTime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function SignInButton({ children }: { children: ReactNode }) {
	return (
		<Link to="/login">
			<Button variant="outline">{children}</Button>
		</Link>
	);
}

/**
 * An issue or pull-request list: one panel whose header (status tabs and
 * filters) stays put while the rows below load, fill or empty out.
 */
export function ThreadList<T extends { id: number }>({
	threads,
	isLoading,
	header,
	emptyIcon,
	emptyMessage,
	emptyAction,
	children,
}: {
	threads: T[] | undefined;
	isLoading: boolean;
	header?: ReactNode;
	emptyIcon?: ReactNode;
	emptyMessage: string;
	emptyAction: ReactNode;
	children: (thread: T) => ReactNode;
}) {
	return (
		<Panel>
			{header && <PanelHeader>{header}</PanelHeader>}
			{isLoading ? (
				<ul aria-busy="true" className="divide-y divide-bjork-border-muted">
					{[1, 2, 3].map((i) => (
						<li key={i} className="flex items-start gap-3 px-5 py-3.5">
							<Skeleton className="mt-0.5 size-4 rounded-full" />
							<div className="flex-1 space-y-2">
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-3 w-1/3" />
							</div>
						</li>
					))}
				</ul>
			) : !threads?.length ? (
				<EmptyState
					bare
					icon={emptyIcon}
					message={emptyMessage}
					action={emptyAction}
				/>
			) : (
				<ul className="divide-y divide-bjork-border-muted">
					{threads.map((thread) => (
						<li key={thread.id}>{children(thread)}</li>
					))}
				</ul>
			)}
		</Panel>
	);
}

type ThreadSummary = {
	number: number;
	title: string;
	status: string;
	/** Pull requests only: an open draft shows as a draft. */
	isDraft?: boolean;
	createdAt: Date | string;
	author: { name: string };
	labels: {
		id: number;
		name: string;
		color: string;
		description?: string | null;
	}[];
};

const rowClass =
	"flex w-full items-start gap-3 px-5 py-3.5 text-left no-underline transition-[background-color] duration-150 hover:bg-bjork-surface-hover focus-visible:bg-bjork-surface-hover focus-visible:outline-none data-[status=active]:bg-bjork-surface-active data-[status=active]:shadow-[inset_2px_0_0_var(--bjork-accent)]";

/** The status glyph sits on the row's first text line, not centred on the row. */
function StatusIcon({
	kind,
	status,
}: {
	kind: "issue" | "pull";
	status: string;
}) {
	const iconClass = "mt-0.5 size-4 shrink-0";
	if (kind === "issue") {
		return status === "open" ? (
			<CircleDot className={`${iconClass} text-success`} aria-hidden="true" />
		) : (
			<CircleCheck className={`${iconClass} text-merged`} aria-hidden="true" />
		);
	}
	if (status === "draft") {
		return (
			<GitPullRequestDraft
				className={`${iconClass} text-muted-foreground`}
				aria-hidden="true"
			/>
		);
	}
	if (status === "open") {
		return (
			<GitPullRequest
				className={`${iconClass} text-success`}
				aria-hidden="true"
			/>
		);
	}
	if (status === "merged") {
		return (
			<GitMerge className={`${iconClass} text-merged`} aria-hidden="true" />
		);
	}
	if (status === "closed") {
		return (
			<GitPullRequestClosed
				className={`${iconClass} text-destructive`}
				aria-hidden="true"
			/>
		);
	}
	return (
		<CircleX
			className={`${iconClass} text-muted-foreground`}
			aria-hidden="true"
		/>
	);
}

export function ThreadRow({
	kind,
	owner,
	name,
	thread,
	children,
}: {
	kind: "issue" | "pull";
	owner: string;
	name: string;
	thread: ThreadSummary;
	children?: ReactNode;
}) {
	const createdAt = new Date(thread.createdAt);
	const status =
		kind === "pull" && thread.status === "open" && thread.isDraft
			? "draft"
			: thread.status;
	const content = (
		<>
			<StatusIcon kind={kind} status={status} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
					<span className="min-w-0 break-words text-sm font-semibold text-bjork-text">
						{thread.title}
					</span>
					<span className="sr-only">({status})</span>
					{thread.labels.map((label) => (
						<LabelChip key={label.id} {...label} />
					))}
				</div>
				<p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-bjork-text-soft">
					<span className="font-mono tabular-nums">#{thread.number}</span>
					<span>
						opened <RelativeTime date={createdAt} /> by{" "}
						<span className="text-bjork-text-medium">{thread.author.name}</span>
					</span>
					{children && (
						<>
							<span aria-hidden="true">&middot;</span>
							{children}
						</>
					)}
				</p>
			</div>
		</>
	);
	const id = thread.number.toString();
	return kind === "issue" ? (
		<Link
			to="/$owner/$name/issues/$id"
			params={{ owner, name, id }}
			className={rowClass}
		>
			{content}
		</Link>
	) : (
		<Link
			to="/$owner/$name/pull/$id/{-$tab}"
			params={{ owner, name, id }}
			className={rowClass}
		>
			{content}
		</Link>
	);
}
