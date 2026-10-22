import { Link } from "@tanstack/react-router";
import {
	CircleCheck,
	CircleDot,
	CircleX,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LabelChip } from "@/components/LabelChip";
import {
	issueStatusVariant,
	pullRequestStatusVariant,
} from "@/components/status-variants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function SignInButton({ children }: { children: ReactNode }) {
	return (
		<Link to="/auth/login">
			<Button variant="outline">{children}</Button>
		</Link>
	);
}

export function ThreadList<T extends { id: number }>({
	threads,
	isLoading,
	emptyMessage,
	emptyAction,
	children,
}: {
	threads: T[] | undefined;
	isLoading: boolean;
	emptyMessage: string;
	emptyAction: ReactNode;
	children: (thread: T) => ReactNode;
}) {
	if (isLoading) {
		return (
			<div className="space-y-2">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-16" />
				))}
			</div>
		);
	}
	if (!threads?.length) {
		return <EmptyState message={emptyMessage} action={emptyAction} />;
	}
	return (
		<div className="island-shell divide-y divide-border overflow-hidden rounded-[20px]">
			{threads.map((thread) => (
				<Fragment key={thread.id}>{children(thread)}</Fragment>
			))}
		</div>
	);
}

type ThreadSummary = {
	number: number;
	title: string;
	status: string;
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
	"flex w-full items-start gap-3 px-4 py-3.5 text-left no-underline transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none";

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
	const content = (
		<>
			<StatusIcon kind={kind} status={thread.status} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
					<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
						#{thread.number}
					</span>
					<span className="min-w-0 break-words text-sm font-semibold text-foreground">
						{thread.title}
					</span>
					{thread.labels.map((label) => (
						<LabelChip key={label.id} {...label} />
					))}
					<Badge
						className="shrink-0"
						variant={
							kind === "issue"
								? issueStatusVariant(thread.status)
								: pullRequestStatusVariant(thread.status)
						}
					>
						{thread.status}
					</Badge>
				</div>
				<p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span>
						opened {new Date(thread.createdAt).toLocaleDateString()} by{" "}
						{thread.author.name}
					</span>
					{children && (
						<>
							<span aria-hidden="true" className="text-border">
								&middot;
							</span>
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
			to="/$owner/$name/pulls/$id"
			params={{ owner, name, id }}
			className={rowClass}
		>
			{content}
		</Link>
	);
}
