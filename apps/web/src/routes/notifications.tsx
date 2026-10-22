import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { CircleDot, GitPullRequest } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth-session";
import { MAX_LIST_SKIP } from "@/lib/limits";
import {
	NOTIFICATION_REASON_LABELS,
	NOTIFICATIONS_PER_PAGE_MAX,
	type NotificationItem,
} from "@/lib/notifications";
import { notificationsQueryOptions, queryKeys } from "@/lib/query-options";
import { cn } from "@/lib/utils";
import {
	markAllNotificationsRead,
	markNotificationRead,
} from "@/server/notifications";

interface NotificationsSearch {
	all?: boolean;
	participating?: boolean;
	page?: number;
}

const MAX_PAGE = MAX_LIST_SKIP / NOTIFICATIONS_PER_PAGE_MAX + 1;

export const Route = createFileRoute("/notifications")({
	validateSearch: (search: Record<string, unknown>): NotificationsSearch => {
		const page = Number(search.page);
		return {
			...(search.all === true || search.all === "true" ? { all: true } : {}),
			...(search.participating === true || search.participating === "true"
				? { participating: true }
				: {}),
			...(Number.isInteger(page) && page > 1
				? { page: Math.min(page, MAX_PAGE) }
				: {}),
		};
	},
	beforeLoad: async () => {
		const session = await getSession();
		if (!session?.user) throw redirect({ to: "/auth/login" });
	},
	loaderDeps: ({ search }) => ({
		all: search.all ?? false,
		participating: search.participating ?? false,
		page: search.page ?? 1,
	}),
	loader: ({ context: { queryClient }, deps }) =>
		queryClient.ensureQueryData(notificationsQueryOptions(deps)),
	head: () => ({ meta: [{ title: "Notifications · PushStack" }] }),
	component: NotificationsPage,
});

const FILTERS = [
	{ label: "Unread", search: {} },
	{ label: "Participating", search: { participating: true } },
	{ label: "All", search: { all: true } },
] as const;

function NotificationsPage() {
	const search = Route.useSearch();
	const filter = {
		all: search.all ?? false,
		participating: search.participating ?? false,
		page: search.page ?? 1,
	};
	const filterSearch = {
		...(search.all ? { all: true } : {}),
		...(search.participating ? { participating: true } : {}),
	};
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data, isError, refetch } = useQuery(
		notificationsQueryOptions(filter),
	);
	const hasNextPage =
		(data?.length ?? 0) === NOTIFICATIONS_PER_PAGE_MAX &&
		filter.page < MAX_PAGE;
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot });
	const onError = (error: Error) =>
		toast(error.message || "Couldn't update notifications", "error");
	const markOne = useMutation({
		mutationFn: (id: number) => markNotificationRead({ data: { id } }),
		onSuccess: refresh,
		onError,
	});
	const markAll = useMutation({
		mutationFn: () => markAllNotificationsRead(),
		onSuccess: refresh,
		onError,
	});

	return (
		<div className="page-wrap py-6 sm:py-8">
			<PageHeader
				title="Notifications"
				actions={
					<Button
						variant="outline"
						disabled={markAll.isPending || !data?.some((n) => n.unread)}
						onClick={() => markAll.mutate()}
					>
						Mark all as read
					</Button>
				}
			/>
			<nav
				className="mb-4 flex flex-wrap items-center gap-2"
				aria-label="Notification filters"
			>
				{FILTERS.map(({ label, search: target }) => {
					const active =
						filter.all === "all" in target &&
						filter.participating === "participating" in target;
					return (
						<Link
							key={label}
							to="/notifications"
							search={target}
							aria-current={active ? "page" : undefined}
							className={cn(
								"inline-flex h-10 items-center rounded-[13px] border px-4 text-sm no-underline transition-colors",
								active
									? "border-primary bg-primary text-primary-foreground"
									: "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{label}
						</Link>
					);
				})}
			</nav>
			{isError ? (
				<EmptyState
					variant="error"
					message="Could not load notifications."
					action={<Button onClick={() => refetch()}>Retry</Button>}
				/>
			) : data?.length === 0 ? (
				<EmptyState
					message={
						filter.all
							? "No notifications yet."
							: "All caught up! No unread notifications."
					}
				/>
			) : (
				<ul className="island-shell divide-y divide-border overflow-hidden rounded-[20px]">
					{data?.map((item) => (
						<NotificationRow
							key={item.id}
							item={item}
							onRead={() => markOne.mutate(item.id)}
							pending={markOne.isPending && markOne.variables === item.id}
						/>
					))}
				</ul>
			)}
			{(filter.page > 1 || hasNextPage) && (
				<nav
					className="mt-4 flex items-center justify-between"
					aria-label="Notification pages"
				>
					{filter.page > 1 ? (
						<Link
							to="/notifications"
							search={{
								...filterSearch,
								...(filter.page > 2 ? { page: filter.page - 1 } : {}),
							}}
							className="text-sm"
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-sm text-muted-foreground">
						Page {filter.page}
					</span>
					{hasNextPage ? (
						<Link
							to="/notifications"
							search={{ ...filterSearch, page: filter.page + 1 }}
							className="text-sm"
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</div>
	);
}

function NotificationRow({
	item,
	onRead,
	pending,
}: {
	item: NotificationItem;
	onRead: () => void;
	pending: boolean;
}) {
	const Icon = item.subject.type === "PullRequest" ? GitPullRequest : CircleDot;
	return (
		<li
			className={cn(
				"flex items-start gap-3 px-4 py-3.5",
				!item.unread && "opacity-70",
			)}
		>
			<Icon
				aria-hidden="true"
				className={cn(
					"mt-0.5 size-4 shrink-0",
					item.subject.state === "open" ? "text-success" : "text-merged",
				)}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<span
						aria-hidden="true"
						className={cn(
							"size-2 shrink-0 rounded-full",
							item.unread ? "bg-primary" : "bg-transparent",
						)}
					/>
					<span className="sr-only">{item.unread ? "Unread" : "Read"}</span>
					<Link
						to={
							item.subject.type === "Issue"
								? "/$owner/$name/issues/$id"
								: "/$owner/$name/pulls/$id"
						}
						params={{
							owner: item.repository.owner,
							name: item.repository.name,
							id: String(item.subject.number),
						}}
						onClick={() => item.unread && onRead()}
						className={cn(
							"block min-w-0 flex-1 truncate text-sm text-foreground hover:underline",
							item.unread && "font-semibold",
						)}
					>
						{item.subject.title}
					</Link>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					{item.repository.owner}/{item.repository.name} #{item.subject.number}
				</p>
			</div>
			<Badge variant="outline" className="shrink-0">
				{NOTIFICATION_REASON_LABELS[item.reason]}
			</Badge>
			<time
				className="hidden shrink-0 text-xs text-muted-foreground sm:block"
				dateTime={new Date(item.updatedAt).toISOString()}
			>
				{new Date(item.updatedAt).toLocaleDateString()}
			</time>
			{item.unread && (
				<Button
					variant="ghost"
					className="shrink-0 px-3"
					disabled={pending}
					onClick={onRead}
				>
					Mark as read
				</Button>
			)}
		</li>
	);
}
