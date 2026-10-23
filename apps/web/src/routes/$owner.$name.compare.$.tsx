import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FileDiffViewer } from "@/components/FileDiffViewer";
import { Toolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/PageHeader";
import { CommitList } from "@/components/repo/CommitList";
import { RepoResourceNotFound } from "@/components/repo/RepoResourceNotFound";
import { NewThreadDialog } from "@/components/thread-list/NewThreadDialog";
import { useToast } from "@/components/toast-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseCompareSpec, splitPatchSuffix } from "@/lib/compare-spec";
import { backgroundQuery } from "@/lib/prefetch";
import {
	authSessionQueryOptions,
	queryKeys,
	repositoryBranchesQueryOptions,
	repositoryByNameQueryOptions,
	repositoryComparisonQueryOptions,
} from "@/lib/query-options";
import { createPullRequest } from "@/server/pull-requests";

/**
 * GitHub's compare page, `/{owner}/{repo}/compare/{base}...{head}` (or two-dot `{base}..{head}`, a direct diff; a lone
 * `{head}` compares with the default branch): the commits and files `head`
 * adds, and "Create pull request" when both sides are branches.
 * `/compare/{spec}.diff` and `.patch` are plain text.
 */
export const Route = createFileRoute("/$owner/$name/compare/$")({
	server: {
		handlers: {
			GET: async ({ params, next }) => {
				const suffix = splitPatchSuffix(params._splat ?? "");
				if (!suffix) return next();
				const { serveComparePatch } = await import("#/server/web-patches");
				return serveComparePatch(
					params.owner,
					params.name,
					suffix.name,
					suffix.format,
				);
			},
		},
	},
	loader: async ({ params, context: { queryClient } }) => {
		const repo = await queryClient.ensureQueryData(
			repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
		);
		const spec = parseCompareSpec(params._splat ?? "", params.owner);
		if (repo && spec) {
			backgroundQuery(
				queryClient,
				repositoryComparisonQueryOptions({
					repoId: repo.id,
					base: spec.base ?? repo.defaultBranch,
					head: spec.head,
					separator: spec.separator,
				}),
			);
		}
	},
	component: ComparePage,
});

function ComparePage() {
	const { owner, name, _splat } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data: repo } = useQuery(
		repositoryByNameQueryOptions({ owner, name }),
	);
	const spec = parseCompareSpec(_splat ?? "", owner);
	const separator = spec?.separator ?? "...";
	const base = spec?.base ?? repo?.defaultBranch ?? "";
	const head = spec?.head ?? "";

	const { data: branches } = useQuery({
		...repositoryBranchesQueryOptions(repo?.id ?? 0),
		enabled: !!repo,
	});
	const {
		data: comparison,
		isLoading,
		isError,
	} = useQuery({
		...repositoryComparisonQueryOptions({
			repoId: repo?.id ?? 0,
			base,
			head,
			separator,
		}),
		enabled: !!repo && !!spec,
	});

	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [draft, setDraft] = useState(false);
	const createMutation = useMutation({
		mutationFn: createPullRequest,
		onSuccess: async (pr) => {
			if (!repo) return;
			await queryClient.invalidateQueries({
				queryKey: queryKeys.pullRequestsRoot(repo.id),
			});
			// The sidebar shows open counts from the repository row.
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
			setOpen(false);
			toast("Pull request created", "success");
			navigate({
				to: "/$owner/$name/pull/$id/{-$tab}",
				params: { owner, name, id: String(pr.number) },
			});
		},
		onError: (err: Error) => {
			toast(err.message || "Failed to create pull request", "error");
		},
	});

	if (!repo) return null;
	if (!spec || isError) {
		return (
			<RepoResourceNotFound
				title="Nothing to compare"
				message="One of the revisions doesn't exist in this repository."
			/>
		);
	}

	const branchNames = new Set(branches?.map((b) => b.name));
	const canOpenPull =
		!!session?.user &&
		branchNames.has(base) &&
		branchNames.has(head) &&
		base !== head &&
		(comparison?.aheadBy ?? 0) > 0;
	const goTo = (nextBase: string, nextHead: string) =>
		navigate({
			to: "/$owner/$name/compare/$",
			params: { owner, name, _splat: `${nextBase}${separator}${nextHead}` },
		});

	return (
		<div className="space-y-5">
			<PageHeader
				title="Compare"
				description="See what a branch changes, then open a pull request for it."
			/>

			<Toolbar className="rounded-[18px] border border-bjork-border-muted bg-bjork-surface px-4 py-3 shadow-(--bjork-shadow-soft)">
				<div className="flex flex-wrap items-center gap-3">
					<BranchSelect
						label="base"
						value={base}
						branches={branches?.map((b) => b.name) ?? []}
						onChange={(value) => goTo(value, head)}
					/>
					<ArrowLeft className="size-4 text-bjork-text-soft" aria-hidden />
					<BranchSelect
						label="compare"
						value={head}
						branches={branches?.map((b) => b.name) ?? []}
						onChange={(value) => goTo(base, value)}
					/>
				</div>
				<div className="flex items-center gap-2">
					{canOpenPull && (
						<NewThreadDialog
							open={open}
							onOpenChange={(next) => {
								setOpen(next);
								if (next && !title && comparison?.commits.length === 1) {
									setTitle(comparison.commits[0]?.message.split("\n")[0] ?? "");
								}
							}}
							triggerLabel="Create pull request"
							title="Create pull request"
							description={`Merge ${head} into ${base}`}
							submitLabel="Create pull request"
							canSubmit={!!title.trim()}
							isPending={createMutation.isPending}
							onSubmit={() =>
								createMutation.mutate({
									data: {
										repoId: repo.id,
										title,
										body,
										sourceBranchName: head,
										targetBranchName: base,
										draft,
									},
								})
							}
						>
							<div className="space-y-1.5">
								<Label htmlFor="compare-title">Title</Label>
								<Input
									id="compare-title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="Pull request title"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="compare-body">Description</Label>
								<Textarea
									id="compare-body"
									value={body}
									onChange={(e) => setBody(e.target.value)}
									placeholder="Describe your changes…"
									rows={5}
								/>
							</div>
							<div className="flex items-center gap-2">
								<Switch
									id="compare-draft"
									checked={draft}
									onCheckedChange={setDraft}
								/>
								<Label htmlFor="compare-draft">Create as draft</Label>
							</div>
						</NewThreadDialog>
					)}
				</div>
			</Toolbar>

			{isLoading || !comparison ? (
				<FileDiffViewer isLoading />
			) : comparison.status === "identical" ? (
				<EmptyState
					message={`There isn't anything to compare: ${base} and ${head} are identical.`}
				/>
			) : (
				<>
					<p className="text-sm text-bjork-text-muted">
						{comparison.aheadBy} commit{comparison.aheadBy === 1 ? "" : "s"}{" "}
						ahead, {comparison.behindBy} behind · {comparison.diff.files.length}{" "}
						file
						{comparison.diff.files.length === 1 ? "" : "s"} changed ·{" "}
						<a
							className="text-bjork-accent hover:underline"
							href={`/${owner}/${name}/compare/${base}${separator}${head}.diff`}
						>
							diff
						</a>{" "}
						·{" "}
						<a
							className="text-bjork-accent hover:underline"
							href={`/${owner}/${name}/compare/${base}${separator}${head}.patch`}
						>
							patch
						</a>
					</p>
					{comparison.commits.length > 0 && (
						<CommitList
							owner={owner}
							name={name}
							repoId={repo?.id}
							commits={comparison.commits}
							header={
								<h2 className="text-sm font-semibold text-bjork-text-strong">
									{comparison.commits.length}{" "}
									{comparison.commits.length === 1 ? "commit" : "commits"}
								</h2>
							}
						/>
					)}
					<FileDiffViewer
						files={comparison.diff.files}
						sides={{
							owner,
							name,
							oldRef: comparison.diff.oldRef ?? comparison.mergeBaseSha,
							newRef: comparison.headSha,
						}}
						emptyMessage="No file changes."
					/>
				</>
			)}
		</div>
	);
}

function BranchSelect({
	label,
	value,
	branches,
	onChange,
}: {
	label: string;
	value: string;
	branches: string[];
	onChange: (value: string) => void;
}) {
	const options = branches.includes(value) ? branches : [value, ...branches];
	return (
		<div className="flex items-center gap-2">
			<Label className="text-muted-foreground">{label}:</Label>
			<Select value={value} onValueChange={(next) => next && onChange(next)}>
				<SelectTrigger className="min-w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((branch) => (
						<SelectItem key={branch} value={branch}>
							{branch}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
