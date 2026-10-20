import { Link } from "@tanstack/react-router";
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

/** A "Sign in to …" button for signed-out visitors. */
export function SignInButton({ children }: { children: ReactNode }) {
	return (
		<Link to="/auth/login">
			<Button size="sm" variant="outline">
				{children}
			</Button>
		</Link>
	);
}

/** Skeleton rows while loading, the empty state when there are none, else the rows. */
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
		<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
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
	"flex w-full items-start gap-4 p-4 text-left no-underline transition hover:bg-card";

/**
 * One list row: title, status badge, "#N opened … by …" line (`children` adds
 * trailing items to it) and label chips. `kind` picks the detail route.
 */
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
		<div className="min-w-0 flex-1 space-y-1">
			<div className="flex min-w-0 items-center gap-2">
				<span className="min-w-0 truncate text-sm font-medium text-foreground">
					{thread.title}
				</span>
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
			<p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
				<span>
					#{thread.number} opened{" "}
					{new Date(thread.createdAt).toLocaleDateString()} by{" "}
					{thread.author.name}
				</span>
				{children}
			</p>
			{thread.labels.length > 0 && (
				<div className="flex flex-wrap gap-1.5 pt-0.5">
					{thread.labels.map((l) => (
						<LabelChip key={l.id} {...l} />
					))}
				</div>
			)}
		</div>
	);
	const id = thread.number.toString();
	return kind === "issue" ? (
		<Link
			to="/repo/$owner/$name/issues/$id"
			params={{ owner, name, id }}
			className={rowClass}
		>
			{content}
		</Link>
	) : (
		<Link
			to="/repo/$owner/$name/pulls/$id"
			params={{ owner, name, id }}
			className={rowClass}
		>
			{content}
		</Link>
	);
}
