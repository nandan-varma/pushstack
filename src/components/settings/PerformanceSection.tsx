import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Section } from "@/components/Section";
import { LoadingButton } from "@/components/ui/loading-button";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query-options";
import { repackRepository, updateRepository } from "@/server/repositories";

function ToggleRow({
	id,
	label,
	hint,
	checked,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	hint: string;
	checked: boolean;
	disabled: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<label
					htmlFor={id}
					className="text-sm font-medium text-[var(--sea-ink)]"
				>
					{label}
				</label>
				<p className="mt-0.5 text-xs text-[var(--sea-ink-soft)]">{hint}</p>
			</div>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onChange}
				className="mt-0.5 shrink-0"
			/>
		</div>
	);
}

export function PerformanceSection({
	repo,
	owner,
	name,
}: {
	repo: {
		id: number;
		showLastCommitColumn: boolean;
		autoRefreshPrDiffs: boolean;
	};
	owner: string;
	name: string;
}) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: updateRepository,
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.repositoryByName(owner, name),
			});
		},
	});

	const repackMutation = useMutation({
		mutationFn: () => repackRepository({ data: { id: repo.id } }),
	});

	return (
		<Section
			title="Performance"
			description="Both off by default — each re-walks git history or polls on a timer, which costs real R2 calls and server time on every visit. Turn on only if you actually want the extra info live."
		>
			<div className="divide-y divide-[var(--line)]">
				<ToggleRow
					id="show-last-commit-column"
					label="Show last commit per file in the file browser"
					hint="Walks up to 400 commits of history to resolve which commit last touched each file — visitors can still see this on a file's own page."
					checked={repo.showLastCommitColumn}
					disabled={mutation.isPending}
					onChange={(value) =>
						mutation.mutate({
							data: { id: repo.id, showLastCommitColumn: value },
						})
					}
				/>
				<ToggleRow
					id="auto-refresh-pr-diffs"
					label="Keep pull request diffs live"
					hint="Re-fetches the file diff every 20 seconds while a pull request is open, so it updates if either branch gets pushed to. Off loads the diff once."
					checked={repo.autoRefreshPrDiffs}
					disabled={mutation.isPending}
					onChange={(value) =>
						mutation.mutate({
							data: { id: repo.id, autoRefreshPrDiffs: value },
						})
					}
				/>
			</div>
			{mutation.isError && (
				<p className="mt-3 text-sm text-red-600 dark:text-red-400">
					{(mutation.error as Error).message}
				</p>
			)}
			<div className="mt-4 flex items-start justify-between gap-4 border-t border-[var(--line)] pt-4">
				<div className="min-w-0">
					<p className="text-sm font-medium text-[var(--sea-ink)]">
						Consolidate pack files
					</p>
					<p className="mt-0.5 text-xs text-[var(--sea-ink-soft)]">
						Every push already consolidates old pack files once there are
						several — this is only for repos that built up a backlog before that
						started, where every cold visit has to fetch every leftover pack.
						Safe to run any time; does nothing if there's nothing to
						consolidate.
					</p>
				</div>
				<LoadingButton
					variant="outline"
					size="sm"
					className="shrink-0"
					isLoading={repackMutation.isPending}
					loadingLabel="Consolidating…"
					onClick={() => repackMutation.mutate()}
				>
					Consolidate now
				</LoadingButton>
			</div>
			{repackMutation.isError && (
				<p className="mt-2 text-sm text-red-600 dark:text-red-400">
					{(repackMutation.error as Error).message}
				</p>
			)}
			{repackMutation.isSuccess && (
				<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
					{repackMutation.data.removedPacks > 0
						? `Consolidated — removed ${repackMutation.data.removedPacks} redundant pack file${repackMutation.data.removedPacks === 1 ? "" : "s"}.`
						: "Already consolidated — nothing to do."}
				</p>
			)}
		</Section>
	);
}
