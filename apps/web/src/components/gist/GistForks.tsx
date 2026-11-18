import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/layout/panel";

export interface GistFork {
	id: string;
	description: string | null;
	updatedAt: string;
	owner: { username: string };
}

/** The gists forked from this one, as GitHub lists them under the files. */
export function GistForks({ forks }: { forks: readonly GistFork[] }) {
	if (forks.length === 0) return null;
	return (
		<Panel>
			<PanelHeader title={`Forks (${forks.length})`} />
			<ul className="divide-y divide-bjork-border-muted">
				{forks.map((fork) => (
					<li key={fork.id} className="flex gap-3 px-5 py-3 text-sm">
						<Link
							to="/gist/$owner/$id"
							params={{ owner: fork.owner.username, id: fork.id }}
							className="font-semibold hover:underline"
						>
							{fork.owner.username}
						</Link>
						<span className="truncate text-bjork-text-muted">
							{fork.description || "No description"}
						</span>
					</li>
				))}
			</ul>
		</Panel>
	);
}
