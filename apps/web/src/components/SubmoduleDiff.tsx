import { Link } from "@tanstack/react-router";
import type { DiffFile } from "git-fs-s3/ops";
import type { DiffSides } from "./FileDiffViewer";

/** Pointers belong to the submodule repository, not to the parent object's database. */
export function SubmoduleDiff({
	file,
	sides,
}: {
	file: DiffFile;
	sides?: DiffSides;
}) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{[
				{ label: "Before", entry: file.oldEntry, ref: sides?.oldRef },
				{ label: "After", entry: file.newEntry, ref: sides?.newRef },
			].map(({ label, entry, ref }) => (
				<div
					key={label}
					className="min-w-0 space-y-2 rounded-md border border-border p-3 text-sm"
				>
					<p className="font-medium">{label}</p>
					{entry ? (
						<>
							<p className="text-muted-foreground">
								{entry.type === "commit"
									? "Submodule commit"
									: entry.type === "tree"
										? "Directory"
										: "File"}
							</p>
							<code className="block break-all text-xs">{entry.oid}</code>
							{sides && ref && (
								<Link
									to={
										entry.type === "tree"
											? "/$owner/$name/tree/$branch/$"
											: "/$owner/$name/blob/$branch/$"
									}
									params={{
										owner: sides.owner,
										name: sides.name,
										branch: ref,
										_splat: file.path,
									}}
									className="inline-block text-primary underline underline-offset-4"
								>
									{entry.type === "commit" ? "View submodule" : "View path"}
								</Link>
							)}
						</>
					) : (
						<p className="text-muted-foreground">Not present</p>
					)}
				</div>
			))}
		</div>
	);
}
