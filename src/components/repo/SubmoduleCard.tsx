import { ExternalLink, GitFork } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { submoduleLinks } from "@/lib/submodule";

export function SubmoduleCard({
	oid,
	url,
	owner,
	name,
}: {
	oid: string;
	url: string | null;
	owner: string;
	name: string;
}) {
	const links = submoduleLinks(url, oid, { owner, name });
	return (
		<Card className="gap-5 p-5 sm:p-6">
			<div className="flex items-center gap-2">
				<GitFork className="size-5 text-primary" aria-hidden="true" />
				<h2 className="font-semibold">Submodule</h2>
			</div>
			<p className="text-sm text-muted-foreground">
				This path points to a commit in another repository. Its files are stored
				there.
			</p>
			<dl className="space-y-3 text-sm">
				<div>
					<dt className="text-muted-foreground">Pinned commit</dt>
					<dd className="mt-1 break-all font-mono">{oid}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Repository URL</dt>
					<dd className="mt-1 break-all font-mono">
						{url ?? "No matching entry in .gitmodules at this revision."}
					</dd>
				</div>
			</dl>
			{links && (
				<div className="flex flex-wrap gap-2">
					{links.commit && (
						<a
							className={`${buttonVariants({ size: "sm" })} min-h-11`}
							href={links.commit}
						>
							<ExternalLink className="size-4" aria-hidden="true" />
							Browse pinned commit
						</a>
					)}
					<a
						className={`${buttonVariants({ variant: "outline", size: "sm" })} min-h-11`}
						href={links.repository}
					>
						Open repository
					</a>
				</div>
			)}
			{url && !links && (
				<p className="text-sm text-muted-foreground">
					This clone URL has no supported browser link.
				</p>
			)}
			<div className="space-y-2 border-t border-border pt-4 text-sm">
				<p>To download submodules in your local clone:</p>
				<pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
					<code>git submodule update --init --recursive</code>
				</pre>
				<p className="text-muted-foreground">
					Update the pinned commit with Git and push the parent repository.
					Private submodules require access to their own repositories.
				</p>
			</div>
		</Card>
	);
}
