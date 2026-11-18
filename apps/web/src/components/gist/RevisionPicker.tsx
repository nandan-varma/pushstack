import { RelativeTime } from "@/components/RelativeTime";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface GistRevision {
	sha: string;
	createdAt: string;
}

/**
 * The revision picker: "Latest" is HEAD, every other option one commit of the
 * gist's history, as GitHub lists them.
 */
export function RevisionPicker({
	revisions,
	value,
	onChange,
}: {
	revisions: readonly GistRevision[];
	value: string;
	onChange: (revision: string) => void;
}) {
	const current = revisions.find((revision) => revision.sha === value);
	return (
		<Select value={value} onValueChange={(next) => next && onChange(next)}>
			<SelectTrigger aria-label="Gist revision" className="w-[220px]">
				<SelectValue>
					{current ? current.sha.slice(0, 7) : "Latest"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="HEAD">Latest</SelectItem>
				{revisions.map((revision) => (
					<SelectItem key={revision.sha} value={revision.sha}>
						<span className="font-mono">{revision.sha.slice(0, 7)}</span>
						<span className="ml-2 text-bjork-text-muted">
							<RelativeTime date={revision.createdAt} />
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
