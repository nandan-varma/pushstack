import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Section } from "@/components/Section";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query-options";
import { updateRepository } from "@/server/repositories";

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
		</Section>
	);
}
