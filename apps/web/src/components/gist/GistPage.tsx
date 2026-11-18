import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { Panel } from "@/components/layout/panel";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getGistCloneUrl } from "@/lib/git-utils";
import {
	authSessionQueryOptions,
	gistPageQueryOptions,
} from "@/lib/query-options";
import { GistComments } from "./GistComments";
import { GistFileViewer } from "./GistFileViewer";
import { GistForks } from "./GistForks";
import { GistStarButton } from "./GistStarButton";
import { RevisionPicker } from "./RevisionPicker";

/** One gist's page: files at a revision, stars, forks, comments and clone. */
export function GistPage({
	owner,
	id,
	revision,
}: {
	owner: string;
	id: string;
	revision?: string;
}) {
	const navigate = useNavigate();
	const { data: session } = useQuery(authSessionQueryOptions());
	const { data, isLoading, error } = useQuery(
		gistPageQueryOptions({ owner, id, revision }),
	);
	const { copied, copy } = useCopyToClipboard();
	const cloneUrl = getGistCloneUrl(id);

	if (error) {
		return (
			<Panel className="px-5 py-8 text-sm text-bjork-text-muted">
				We couldn't read this gist. It may have been deleted.
			</Panel>
		);
	}
	if (isLoading || !data) return <Skeleton className="h-60" />;

	const { gist } = data;
	const selectRevision = (next: string) => {
		if (next === "HEAD") {
			navigate({
				to: "/gist/$owner/$id",
				params: { owner, id },
				replace: true,
			});
		} else {
			navigate({
				to: "/gist/$owner/$id/$revision",
				params: { owner, id, revision: next },
				replace: true,
			});
		}
	};

	return (
		<div className="space-y-5">
			<PageHeader
				title={
					<Link
						to="/$owner"
						params={{ owner: gist.owner.username }}
						className="hover:underline"
					>
						{gist.owner.username}
					</Link>
				}
				description={gist.description || "No description"}
				actions={
					<div className="flex items-center gap-2">
						<span className="rounded-full border border-bjork-border-muted px-2.5 py-1 text-xs text-bjork-text-muted">
							{gist.visibility === "public" ? "Public" : "Secret"}
						</span>
						<div className="w-36">
							<GistStarButton
								owner={owner}
								id={id}
								revision={data.revision}
								isStarred={data.isStarred}
								starCount={data.starCount}
							/>
						</div>
					</div>
				}
			/>

			{gist.forkOf && (
				<p className="text-sm text-bjork-text-muted">
					Forked from{" "}
					<Link
						to="/gist/$owner/$id"
						params={{ owner: gist.forkOf.owner.username, id: gist.forkOf.id }}
						className="underline"
					>
						{gist.forkOf.owner.username}/{gist.forkOf.id}
					</Link>
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<RevisionPicker
					revisions={data.revisions}
					value={data.revision}
					onChange={selectRevision}
				/>
				<div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-bjork-border-muted bg-bjork-surface-muted px-2 py-1">
					<input
						readOnly
						aria-label="Clone URL"
						value={cloneUrl}
						className="min-w-0 flex-1 bg-transparent font-mono text-xs text-bjork-text"
					/>
					<Button
						variant="ghost"
						size="sm"
						aria-label="Copy clone URL"
						onClick={() => void copy(cloneUrl)}
					>
						{copied ? (
							<Check aria-hidden="true" className="h-4 w-4" />
						) : (
							<Copy aria-hidden="true" className="h-4 w-4" />
						)}
					</Button>
				</div>
			</div>

			<GistFileViewer
				key={data.revision}
				owner={owner}
				id={id}
				revision={data.revision}
				files={data.files}
			/>

			<GistForks forks={data.forks} />

			<GistComments
				owner={owner}
				id={id}
				comments={data.comments}
				signedIn={Boolean(session)}
			/>
		</div>
	);
}
