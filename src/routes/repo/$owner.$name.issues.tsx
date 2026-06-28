import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	queryKeys,
	repositoryByNameQueryOptions,
	repositoryIssuesQueryOptions,
} from "@/lib/query-options";
import { createIssue } from "@/server/issues";

const STATUS_VALUES = ["open", "closed", "all"] as const;
type IssueStatus = (typeof STATUS_VALUES)[number];

export const Route = createFileRoute("/repo/$owner/$name/issues")({
	validateSearch: (search: Record<string, unknown>) => ({
		status: (STATUS_VALUES.includes(search.status as IssueStatus)
			? search.status
			: "open") as IssueStatus,
	}),
	loaderDeps: ({ search }) => ({ status: search.status }),
	loader: async ({ params, deps, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		if (repo) {
			await queryClient.ensureQueryData(
				repositoryIssuesQueryOptions({ repoId: repo.id, status: deps.status }),
			);
		}
	},
	component: IssuesPage,
});

const filterTabBase =
	"border-b-2 px-1 pb-3 text-sm font-medium transition [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]";
const filterTabInactive =
	"border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]";
const filterTabActive = "border-[var(--lagoon-deep)] text-[var(--lagoon-deep)]";

function IssuesPage() {
	const { owner, name } = Route.useParams();
	const { status: filter } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newIssue, setNewIssue] = useState({ title: "", body: "" });

	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);

	const { data: issues, isLoading } = useQuery({
		...repositoryIssuesQueryOptions({ repoId: repo?.id ?? 0, status: filter }),
		enabled: !!repo,
	});

	const createMutation = useMutation({
		mutationFn: createIssue,
		onSuccess: async () => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.repoIssuesRoot(repo.id),
			});
			setIsCreateOpen(false);
			setNewIssue({ title: "", body: "" });
		},
	});

	const openCount = issues?.filter((i) => i.status === "open").length || 0;
	const closedCount = issues?.filter((i) => i.status === "closed").length || 0;

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between gap-4">
				<h2 className="text-base font-semibold text-[var(--sea-ink)]">
					Issues
				</h2>
				<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
					<DialogTrigger asChild>
						<Button size="sm">New issue</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create new issue</DialogTitle>
							<DialogDescription>
								Report a bug, request a feature, or start a discussion
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<div className="space-y-1.5">
								<Label htmlFor="title">Title</Label>
								<Input
									id="title"
									value={newIssue.title}
									onChange={(e) =>
										setNewIssue((p) => ({ ...p, title: e.target.value }))
									}
									placeholder="Issue title"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="body">Description</Label>
								<Textarea
									id="body"
									value={newIssue.body}
									onChange={(e) =>
										setNewIssue((p) => ({ ...p, body: e.target.value }))
									}
									placeholder="Describe the issue in detail…"
									rows={6}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setIsCreateOpen(false)}>
								Cancel
							</Button>
							<Button
								onClick={() => {
									if (!newIssue.title.trim() || !repo) return;
									createMutation.mutate({
										data: {
											repoId: repo.id,
											title: newIssue.title,
											body: newIssue.body,
										},
									});
								}}
								disabled={!newIssue.title.trim() || createMutation.isPending}
							>
								{createMutation.isPending ? "Creating…" : "Create issue"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			{/* Filter tabs */}
			<div className="flex items-center gap-5 border-b border-[var(--line)]">
				{(
					[
						["open", `Open (${openCount})`],
						["closed", `Closed (${closedCount})`],
						["all", `All (${issues?.length || 0})`],
					] as const
				).map(([value, label]) => (
					<button
						key={value}
						type="button"
						className={`${filterTabBase} ${filter === value ? filterTabActive : filterTabInactive}`}
						onClick={() =>
							navigate({ search: { status: value }, replace: true })
						}
					>
						{label}
					</button>
				))}
			</div>

			{/* Issues list */}
			{isLoading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-16 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--surface)]"
						/>
					))}
				</div>
			) : !issues?.length ? (
				<div className="island-shell rounded-xl p-12 text-center">
					<p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
						No {filter !== "all" ? filter : ""} issues found.
					</p>
					<Button size="sm" onClick={() => setIsCreateOpen(true)}>
						Create first issue
					</Button>
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border border-[var(--line)]">
					{issues.map((issue, idx) => (
						<button
							type="button"
							key={issue.id}
							className={`flex w-full items-start gap-4 p-4 text-left transition hover:bg-[var(--surface-strong)] ${idx < issues.length - 1 ? "border-b border-[var(--line)]" : ""}`}
							onClick={() =>
								navigate({
									to: "/repo/$owner/$name/issues/$id",
									params: { owner, name, id: issue.id.toString() },
								})
							}
						>
							<div className="flex-1 space-y-1">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-[var(--sea-ink)]">
										{issue.title}
									</span>
									<Badge
										variant={issue.status === "open" ? "success" : "default"}
									>
										{issue.status}
									</Badge>
								</div>
								<p className="text-xs text-[var(--sea-ink-soft)]">
									#{issue.id} opened{" "}
									{formatDistanceToNow(new Date(issue.createdAt), {
										addSuffix: true,
									})}{" "}
									by {issue.author?.name || "Unknown"}
								</p>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
