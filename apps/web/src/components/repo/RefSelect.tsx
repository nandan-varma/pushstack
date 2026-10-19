import { useQuery } from "@tanstack/react-query";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	repositoryBranchesQueryOptions,
	repositoryTagsQueryOptions,
} from "@/lib/query-options";

/**
 * The branch/tag picker shared by the code and commits views. `value` is
 * whatever ref the URL names — a branch, a tag, or a commit sha (a permalink),
 * which shows as itself without matching an option.
 */
export function RefSelect({
	repoId,
	value,
	onChange,
}: {
	repoId: number;
	value: string;
	onChange: (ref: string) => void;
}) {
	const { data: branches = [] } = useQuery(
		repositoryBranchesQueryOptions(repoId),
	);
	const { data: tags = [] } = useQuery(repositoryTagsQueryOptions(repoId));

	return (
		<Select value={value} onValueChange={(ref) => ref && onChange(ref)}>
			<SelectTrigger size="sm" aria-label="Branch or tag">
				<SelectValue>
					{/^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 7) : value}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					<SelectLabel>Branches</SelectLabel>
					{branches.map((branch) => (
						<SelectItem key={`branch:${branch.name}`} value={branch.name}>
							{branch.name}
							{branch.isDefault ? " (default)" : ""}
						</SelectItem>
					))}
				</SelectGroup>
				{tags.length > 0 && (
					<>
						<SelectSeparator />
						<SelectGroup>
							<SelectLabel>Tags</SelectLabel>
							{tags
								// A branch wins over a same-named tag when resolving, so
								// listing both would offer one ref twice.
								.filter((tag) => !branches.some((b) => b.name === tag.name))
								.map((tag) => (
									<SelectItem key={`tag:${tag.name}`} value={tag.name}>
										{tag.name}
									</SelectItem>
								))}
						</SelectGroup>
					</>
				)}
			</SelectContent>
		</Select>
	);
}
